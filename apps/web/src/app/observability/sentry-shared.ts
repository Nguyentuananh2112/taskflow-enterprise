import type * as Sentry from '@sentry/nextjs';
import type { ErrorEvent, EventHint } from '@sentry/nextjs';

type InitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type TransactionEvent = Parameters<NonNullable<InitOptions['beforeSendTransaction']>>[0];

// Quy tắc chung client + server của Sentry web (T-035 mục 2): KHÔNG gửi PII. Cùng tinh thần allow-list
// với API (T-031 mục 0): dựng event MỚI chỉ từ trường an toàn, không dựa vào danh sách cấm.

/** Tunnel cùng origin ⇒ CSP `connect-src 'self'` đủ, không phải nới cho ingest của Sentry. */
export const SENTRY_TUNNEL_PATH = '/monitoring';

const SCRUBBERS: readonly [RegExp, string][] = [
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@'],
  [/\$argon2(?:id|i|d)\$[^\s)"'`]*/g, '[REDACTED_HASH]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]'],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key)(\s*[=:]\s*)[^\s,;&]+/gi, '$1$2[REDACTED]'],
  [/[A-Za-z0-9+/_=-]{32,}/g, '[REDACTED]'],
];

/** Lọc mẫu dữ liệu nhạy cảm trong chuỗi tự do (message lỗi), cắt dài. */
export function scrubText(text: string): string {
  let out = text.length > 1_000 ? `${text.slice(0, 1_000)}…` : text;
  for (const [pattern, replacement] of SCRUBBERS) out = out.replace(pattern, replacement);
  return out;
}

/** URL: bỏ query + fragment (`?next=`, `?task=` …), rồi lọc mẫu. */
export function scrubUrl(url: string): string {
  return scrubText(url.split(/[?#]/)[0] ?? '');
}

/** Tắt thu thập tại nguồn (Sentry 11 `dataCollection` — mặc định thu cả cookie, header, body, query). */
export const DATA_COLLECTION: NonNullable<InitOptions['dataCollection']> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
};

/** Giao dịch (nếu có trace): bỏ request/user, tên không query. */
export function sanitizeWebTransaction(event: TransactionEvent): TransactionEvent {
  const { request: _request, user: _user, ...rest } = event;
  return { ...rest, ...(event.transaction ? { transaction: scrubUrl(event.transaction) } : {}) };
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$.]{0,100}$/;

type Frames = NonNullable<
  NonNullable<NonNullable<ErrorEvent['exception']>['values']>[number]['stacktrace']
>['frames'];

const safeFrames = (frames: NonNullable<Frames>): NonNullable<Frames> =>
  frames.map((f) => ({
    ...(f.filename ? { filename: scrubUrl(f.filename) } : {}),
    ...(f.function ? { function: f.function } : {}),
    ...(f.lineno !== undefined ? { lineno: f.lineno } : {}),
    ...(f.colno !== undefined ? { colno: f.colno } : {}),
    ...(f.in_app !== undefined ? { in_app: f.in_app } : {}),
  }));

/**
 * `beforeSend` allow-list: chỉ loại lỗi, thông điệp đã lọc, frame (file/hàm/dòng), URL trang KHÔNG
 * query. Bỏ hẳn `user`, `breadcrumbs`, `extra`, header/cookie/body của request.
 */
export function sanitizeWebEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  const values = event.exception?.values?.map((v) => ({
    ...(v.type ? { type: IDENTIFIER.test(v.type) ? v.type : 'Error' } : {}),
    ...(v.value ? { value: scrubText(v.value) } : {}),
    ...(v.mechanism
      ? {
          mechanism: {
            type: v.mechanism.type,
            ...(v.mechanism.handled !== undefined ? { handled: v.mechanism.handled } : {}),
          },
        }
      : {}),
    ...(v.stacktrace?.frames ? { stacktrace: { frames: safeFrames(v.stacktrace.frames) } } : {}),
  }));
  return {
    type: undefined,
    ...(event.event_id ? { event_id: event.event_id } : {}),
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    ...(event.level ? { level: event.level } : {}),
    ...(event.platform ? { platform: event.platform } : {}),
    ...(event.environment ? { environment: event.environment } : {}),
    ...(event.release ? { release: event.release } : {}),
    ...(event.transaction ? { transaction: scrubUrl(event.transaction) } : {}),
    ...(event.message ? { message: scrubText(event.message) } : {}),
    ...(values ? { exception: { values } } : {}),
    ...(event.request?.url ? { request: { url: scrubUrl(event.request.url) } } : {}),
    contexts: {
      ...(event.contexts?.trace ? { trace: event.contexts.trace } : {}),
      ...(event.contexts?.browser ? { browser: event.contexts.browser } : {}),
      ...(event.contexts?.os ? { os: event.contexts.os } : {}),
    },
  };
}
