import * as Sentry from '@sentry/node';

import { requestContext } from '../context/request-context';
import { scrubText, serializeError } from '../logging/error-serializer';
import type { ILogger } from '../logging/logger';

/**
 * Báo lỗi ra dịch vụ ngoài (Sentry — ADR-073, devops.md §6.3). Core chỉ phụ thuộc port này; bản
 * Noop dùng khi không có DSN (local/test, hoặc staging/production thiếu DSN — chỉ cảnh báo).
 */
export interface IErrorReporter {
  /** Chỉ lỗi 5xx và exception không bắt được (devops.md §6.3). Không bao giờ ném. */
  capture(error: unknown): void;
  /** Đẩy hết event đang chờ — gọi trong graceful shutdown. */
  close(timeoutMs: number): Promise<void>;
}

export const noopErrorReporter: IErrorReporter = {
  capture: () => undefined,
  close: () => Promise.resolve(),
};

type NodeOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type ErrorEvent = Sentry.ErrorEvent;
type TransactionEvent = Parameters<NonNullable<NodeOptions['beforeSendTransaction']>>[0];
type StackFrame = NonNullable<
  NonNullable<NonNullable<ErrorEvent['exception']>['values']>[number]['stacktrace']
>['frames'];

/**
 * Integration mặc định bị TẮT:
 * - `OnUncaughtException` / `OnUnhandledRejection`: graceful shutdown (core/lifecycle) đã xử lý và
 *   gọi `capture` — tránh hai bộ xử lý tranh nhau thoát tiến trình;
 * - `LocalVariables`: biến cục bộ (mật khẩu, token…) không bao giờ rời tiến trình;
 * - `ContextLines`, `Modules`, `ChildProcess`, `FileSystem`, `Spotlight`: không cần / có thể mang
 *   dữ liệu (đường dẫn, lệnh) không nằm trong allow-list.
 */
const DISABLED_INTEGRATIONS = new Set([
  'OnUncaughtException',
  'OnUnhandledRejection',
  'LocalVariables',
  'ContextLines',
  'Modules',
  'ChildProcess',
  'FileSystem',
  'Spotlight',
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$.]{0,100}$/;
const SAFE_SPAN_DATA = new Set([
  'http.method',
  'http.request.method',
  'http.response.status_code',
  'http.route',
  'sentry.op',
  'sentry.origin',
  'sentry.source',
  'sentry.sample_rate',
]);

/** URL / tên giao dịch: bỏ query string + fragment, rồi qua bộ lọc mẫu. */
const stripUrl = (value: string): string => scrubText(value.split(/[?#]/)[0] ?? '');

function safeFrames(frames: StackFrame): StackFrame {
  return frames?.map((f) => ({
    ...(f.filename ? { filename: f.filename } : {}),
    ...(f.module ? { module: f.module } : {}),
    ...(f.function ? { function: f.function } : {}),
    ...(f.lineno !== undefined ? { lineno: f.lineno } : {}),
    ...(f.colno !== undefined ? { colno: f.colno } : {}),
    ...(f.in_app !== undefined ? { in_app: f.in_app } : {}),
  }));
}

function reqIdTag(): Record<string, string> {
  const reqId = requestContext.requestId();
  return reqId ? { reqId } : {};
}

/**
 * `beforeSend` theo DANH SÁCH CHO PHÉP (T-035 mục 1): dựng event MỚI chỉ từ các trường an toàn. Phần
 * lỗi dùng CÙNG serializer với log (T-031 mục 0): lỗi Prisma chỉ còn name/code/meta an toàn — không
 * email, hash, token, cookie, body, query. Bỏ hẳn `request`, `user`, `breadcrumbs`, `extra` gốc,
 * biến cục bộ và dòng mã nguồn quanh frame.
 */
export function sanitizeErrorEvent(event: ErrorEvent, hint: Sentry.EventHint): ErrorEvent {
  const original = hint.originalException ?? event.message;
  const safe = serializeError(original, { includeStack: false });
  const summary = safe.message ?? safe.code ?? safe.name;
  const values = event.exception?.values?.map((v, i) => ({
    type: v.type && IDENTIFIER.test(v.type) ? v.type : safe.name,
    // Exception gốc (cuối danh sách) mang thông điệp đã lọc; các exception "cause" chỉ giữ type.
    value: i === (event.exception?.values?.length ?? 0) - 1 ? summary : '',
    ...(v.mechanism
      ? {
          mechanism: {
            type: v.mechanism.type,
            ...(v.mechanism.handled !== undefined ? { handled: v.mechanism.handled } : {}),
          },
        }
      : {}),
    ...(v.stacktrace?.frames
      ? { stacktrace: { frames: safeFrames(v.stacktrace.frames) ?? [] } }
      : {}),
  }));
  return {
    type: undefined,
    ...(event.event_id ? { event_id: event.event_id } : {}),
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    ...(event.level ? { level: event.level } : {}),
    ...(event.platform ? { platform: event.platform } : {}),
    ...(event.environment ? { environment: event.environment } : {}),
    ...(event.release ? { release: event.release } : {}),
    ...(event.fingerprint ? { fingerprint: event.fingerprint } : {}),
    ...(event.message ? { message: scrubText(event.message) } : {}),
    ...(values ? { exception: { values } } : {}),
    tags: { ...reqIdTag(), ...pickSafeTags(event.tags) },
    extra: { error: safe },
    contexts: {
      ...(event.contexts?.trace ? { trace: event.contexts.trace } : {}),
      ...(event.contexts?.runtime ? { runtime: event.contexts.runtime } : {}),
    },
  };
}

function pickSafeTags(tags: ErrorEvent['tags']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (key === 'reqId' && typeof value === 'string') out[key] = value;
  }
  return out;
}

/** `beforeSendTransaction`: chỉ khung thời gian + tên route (không query), span theo allow-list. */
export function sanitizeTransactionEvent(event: TransactionEvent): TransactionEvent {
  return {
    type: 'transaction',
    ...(event.event_id ? { event_id: event.event_id } : {}),
    ...(event.transaction ? { transaction: stripUrl(event.transaction) } : {}),
    ...(event.transaction_info ? { transaction_info: event.transaction_info } : {}),
    ...(event.start_timestamp !== undefined ? { start_timestamp: event.start_timestamp } : {}),
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    ...(event.platform ? { platform: event.platform } : {}),
    ...(event.environment ? { environment: event.environment } : {}),
    ...(event.release ? { release: event.release } : {}),
    ...(event.measurements ? { measurements: event.measurements } : {}),
    tags: { ...reqIdTag(), ...pickSafeTags(event.tags) },
    contexts: {
      ...(event.contexts?.trace
        ? {
            trace: {
              trace_id: event.contexts.trace.trace_id,
              span_id: event.contexts.trace.span_id,
              ...(event.contexts.trace.parent_span_id
                ? { parent_span_id: event.contexts.trace.parent_span_id }
                : {}),
              ...(event.contexts.trace.op ? { op: event.contexts.trace.op } : {}),
              ...(event.contexts.trace.status ? { status: event.contexts.trace.status } : {}),
              data: pickSpanData(event.contexts.trace.data),
            },
          }
        : {}),
    },
    spans: (event.spans ?? []).map((span) => ({
      span_id: span.span_id,
      trace_id: span.trace_id,
      start_timestamp: span.start_timestamp,
      data: pickSpanData(span.data),
      ...(span.parent_span_id ? { parent_span_id: span.parent_span_id } : {}),
      ...(span.timestamp !== undefined ? { timestamp: span.timestamp } : {}),
      ...(span.op ? { op: span.op } : {}),
      status: span.status,
      ...(span.origin ? { origin: span.origin } : {}),
      ...(span.description ? { description: stripUrl(span.description) } : {}),
    })),
  };
}

type SpanData = NonNullable<TransactionEvent['spans']>[number]['data'];

function pickSpanData(data: Record<string, unknown> | undefined): SpanData {
  const out: SpanData = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (!SAFE_SPAN_DATA.has(key)) continue;
    out[key] = (typeof value === 'string' ? stripUrl(value) : value) as SpanData[string];
  }
  return out;
}

export interface SentryReporterOptions {
  dsn: string;
  /** = APP_ENV. */
  environment: string;
  /** = GIT_SHA lúc build. */
  release: string;
  /** Tỉ lệ lấy mẫu trace (0…1), thấp để nằm trong quota gói miễn phí. */
  tracesSampleRate: number;
  logger: ILogger;
  /** Chỉ test: bắt envelope thay vì gửi mạng. */
  transport?: NodeOptions['transport'];
}

/** Khởi tạo Sentry (gọi MỘT lần, trước khi nạp phần còn lại của app — xem main.ts). */
export function createSentryReporter(options: SentryReporterOptions): IErrorReporter {
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: options.tracesSampleRate,
    // Sentry 11: `dataCollection` thay `sendDefaultPii` — mặc định THU THẬP user, cookie, header, body,
    // query… ⇒ tắt hết tại nguồn (lớp 1); `beforeSend` allow-list là lớp 2.
    dataCollection: {
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
    },
    maxBreadcrumbs: 0,
    integrations: (defaults) => defaults.filter((i) => !DISABLED_INTEGRATIONS.has(i.name)),
    beforeSend: sanitizeErrorEvent,
    beforeSendTransaction: sanitizeTransactionEvent,
    beforeBreadcrumb: () => null,
    ...(options.transport ? { transport: options.transport } : {}),
  });
  return {
    capture(error) {
      try {
        Sentry.captureException(error);
      } catch (err) {
        options.logger.warn({ err }, 'observability.sentry_capture_failed');
      }
    },
    async close(timeoutMs) {
      await Sentry.close(timeoutMs).catch(() => undefined);
    },
  };
}
