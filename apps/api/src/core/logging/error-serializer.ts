/**
 * Serializer lỗi theo DANH SÁCH CHO PHÉP (T-031 mục 0, audit T-028): chỉ những trường đã biết là an
 * toàn mới ra log / `details.debug`. Không dùng danh sách cấm — lỗi DB mang dữ liệu dòng
 * (`Failing row contains (… email, $argon2id$…)`), `PrismaClientValidationError.message` in cả cây
 * tham số kèm giá trị, và dòng đầu của `stack` lặp lại message.
 *
 * - Lỗi Prisma (`name` bắt đầu bằng `PrismaClient`): `{ name, code, meta.modelName,
 *   meta.driverAdapterError.cause.{ kind, originalCode, constraint } }`; tên constraint lấy từ
 *   `cause.constraint.index` / `fields` hoặc trích từ `originalMessage` (chỉ khi là định danh SQL).
 *   `PrismaClientValidationError` chỉ còn `name` (+ `code` nếu có). Không message, không stack.
 * - `AppError` / lỗi khác: `name`, `code` (nếu là chuỗi), `message` đã qua bộ lọc mẫu (email,
 *   `$argon2…`, chuỗi base64/hex dài, URL có thông tin đăng nhập, `password=…`/`token=…`,
 *   "Failing row contains (…)"),
 *   `stack` (chỉ các dòng frame `at …`, không dòng message) khi `includeStack`, `cause` đệ quy.
 *
 * Nhận cả `Error` thật lẫn object thường (pino-http chạy serializer chuẩn trước khi gọi serializer
 * tùy biến) — chỉ đọc thuộc tính, không dựa vào `instanceof`.
 */
export interface SafeError {
  name: string;
  code?: string;
  message?: string;
  meta?: SafePrismaMeta;
  stack?: string;
  cause?: SafeError;
}

export interface SafePrismaMeta {
  modelName?: string;
  driverAdapterError?: {
    cause: { kind?: string; originalCode?: string; constraint?: string | string[] };
  };
}

export interface ErrorSerializerOptions {
  /** Ngoài production: giữ các dòng frame của stack (không bao giờ giữ dòng message). */
  includeStack: boolean;
}

const MAX_MESSAGE = 1_000;
const MAX_CAUSE_DEPTH = 3;
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

/** Mẫu dữ liệu nhạy cảm trong message tự do — thứ tự quan trọng (dòng DB trước, rồi từng mẫu). */
const SCRUBBERS: readonly [RegExp, string][] = [
  [/Failing row contains \(.*?\)(?=\.?(\s|$))/gs, 'Failing row contains ([REDACTED])'],
  // Postgres nhắc lại GIÁ TRỊ gốc (lương, số tiền — SEC-PAY-14): khóa trùng, ngoài miền kiểu số, sai cú pháp kiểu.
  [
    /\bKey \(([^)]*)\)=\(.*?\)(?= already exists| is not present|\.|\s|$)/gs,
    'Key ($1)=([REDACTED])',
  ],
  [/\bvalue "[^"]*"(?= is out of range)/g, 'value "[REDACTED]"'],
  [/(invalid input syntax for type [a-z ]+: )"[^"]*"/gi, '$1"[REDACTED]"'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@'],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key)(\s*[=:]\s*)[^\s,;&]+/gi, '$1$2[REDACTED]'],
  // Chuỗi PHC có cả dấu phẩy (`m=19456,t=2,p=1`) ⇒ chỉ dừng ở khoảng trắng / nháy / ngoặc.
  [/\$argon2(?:id|i|d)\$[^\s)"'`]*/g, '[REDACTED_HASH]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]'],
  [/[A-Za-z0-9+/_=-]{32,}/g, '[REDACTED]'],
];

export function scrubText(text: string): string {
  let out = text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text;
  for (const [pattern, replacement] of SCRUBBERS) out = out.replace(pattern, replacement);
  return out;
}

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function nameOf(err: Bag): string {
  const name = str(err['name']) ?? str(err['type']);
  return name && SQL_IDENTIFIER.test(name) ? name : 'Error';
}

/** Chỉ các dòng frame `    at …` — dòng đầu của stack là `${name}: ${message}` (có thể chứa dữ liệu). */
function framesOf(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined;
  const frames = stack.split('\n').filter((line) => /^\s+at\s/.test(line));
  return frames.length ? scrubText(frames.join('\n')) : undefined;
}

function constraintOf(cause: Bag): string | string[] | undefined {
  const constraint = cause['constraint'];
  if (isBag(constraint)) {
    const index = str(constraint['index']);
    if (index && SQL_IDENTIFIER.test(index)) return index;
    const fields = constraint['fields'];
    if (
      Array.isArray(fields) &&
      fields.every((f) => typeof f === 'string' && SQL_IDENTIFIER.test(f))
    )
      return fields as string[];
  }
  const fromMessage = /constraint "([^"]+)"/.exec(str(cause['originalMessage']) ?? '')?.[1];
  return fromMessage && SQL_IDENTIFIER.test(fromMessage) ? fromMessage : undefined;
}

function prismaMeta(meta: unknown): SafePrismaMeta | undefined {
  if (!isBag(meta)) return undefined;
  const out: SafePrismaMeta = {};
  const modelName = str(meta['modelName']);
  if (modelName && SQL_IDENTIFIER.test(modelName)) out.modelName = modelName;
  const adapterError = meta['driverAdapterError'];
  const cause = isBag(adapterError) ? adapterError['cause'] : undefined;
  if (isBag(cause)) {
    const kind = str(cause['kind']);
    const originalCode = str(cause['originalCode']);
    const constraint = constraintOf(cause);
    out.driverAdapterError = {
      cause: {
        ...(kind && SQL_IDENTIFIER.test(kind) ? { kind } : {}),
        ...(originalCode && /^[0-9A-Z]{5}$/.test(originalCode) ? { originalCode } : {}),
        ...(constraint ? { constraint } : {}),
      },
    };
  }
  return Object.keys(out).length ? out : undefined;
}

function serialize(err: unknown, options: ErrorSerializerOptions, depth: number): SafeError {
  if (!isBag(err)) {
    return { name: typeof err, message: scrubText(String(err)) };
  }
  const name = nameOf(err);
  const code = str(err['code']);
  const safeCode = code && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : undefined;

  if (name.startsWith('PrismaClient')) {
    if (name === 'PrismaClientValidationError')
      return { name, ...(safeCode ? { code: safeCode } : {}) };
    const meta = prismaMeta(err['meta']);
    return { name, ...(safeCode ? { code: safeCode } : {}), ...(meta ? { meta } : {}) };
  }

  const out: SafeError = { name };
  if (safeCode) out.code = safeCode;
  const message = str(err['message']);
  if (message) out.message = scrubText(message);
  if (options.includeStack) {
    const stack = framesOf(err['stack']);
    if (stack) out.stack = stack;
  }
  const cause = err['cause'];
  if (cause !== undefined && cause !== null && depth < MAX_CAUSE_DEPTH) {
    out.cause = serialize(cause, options, depth + 1);
  }
  return out;
}

export function serializeError(err: unknown, options: ErrorSerializerOptions): SafeError {
  return serialize(err, options, 0);
}

/** Serializer `err` cho pino — dùng chung cho logger gốc và pino-http. */
export function errorSerializer(options: ErrorSerializerOptions): (err: unknown) => SafeError {
  return (err) => serializeError(err, options);
}
