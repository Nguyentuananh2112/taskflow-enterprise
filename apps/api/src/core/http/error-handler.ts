import type { ErrorRequestHandler, RequestHandler } from 'express';
import * as z from 'zod';

import {
  AppError,
  InternalError,
  PayloadTooLargeError,
  ResourceNotFoundError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../errors';
import { serializeError } from '../logging/error-serializer';
import type { ILogger } from '../logging/logger';
import type { IErrorReporter } from '../observability/sentry';
import type { HttpResponder } from './envelope';
import { validationErrorFromZod } from './zod';

/** Chuyển một loại lỗi "lạ" thành AppError. Chuỗi translator thay cho if/else trong handler. */
export interface ErrorTranslator {
  translate(error: unknown): AppError | undefined;
}

const appErrors: ErrorTranslator = {
  translate: (error) => (error instanceof AppError ? error : undefined),
};

const zodErrors: ErrorTranslator = {
  translate: (error) => (error instanceof z.ZodError ? validationErrorFromZod(error) : undefined),
};

/** Lỗi của `express.json()` (body-parser) mang `type` dạng chuỗi. */
const BODY_PARSER_ERRORS: Readonly<Record<string, () => AppError>> = {
  'entity.too.large': () => new PayloadTooLargeError(),
  'entity.parse.failed': () =>
    new ValidationError([
      { path: [], code: 'invalid_json', message: 'Body không phải JSON hợp lệ.' },
    ]),
  'charset.unsupported': () => new UnsupportedMediaTypeError(),
  'encoding.unsupported': () => new UnsupportedMediaTypeError(),
};

const bodyParserErrors: ErrorTranslator = {
  translate: (error) => {
    const type = (error as { type?: unknown } | null)?.type;
    return typeof type === 'string' ? BODY_PARSER_ERRORS[type]?.() : undefined;
  },
};

/**
 * Lỗi do CLIENT gây ra mà thư viện gắn `status`/`statusCode` 4xx (L3 của T-028): path không giải mã
 * được (URIError của router — 400), body-parser `request.aborted` / `request.size.invalid` (400)…
 * ⇒ 4xx đúng nghĩa, không thành 500 + log error (ai cũng làm ngập alert được).
 */
const clientStatusErrors: ErrorTranslator = {
  translate: (error) => {
    const e = error as { status?: unknown; statusCode?: unknown } | null;
    const status = typeof e?.status === 'number' ? e.status : e?.statusCode;
    if (typeof status !== 'number' || status < 400 || status > 499) return undefined;
    if (status === 413) return new PayloadTooLargeError();
    if (status === 415) return new UnsupportedMediaTypeError();
    return new ValidationError([
      { path: [], code: 'bad_request', message: 'Yêu cầu không hợp lệ.' },
    ]);
  },
};

export const DEFAULT_TRANSLATORS: readonly ErrorTranslator[] = [
  appErrors,
  zodErrors,
  bodyParserErrors,
  clientStatusErrors,
];

export function toAppError(
  error: unknown,
  translators: readonly ErrorTranslator[] = DEFAULT_TRANSLATORS,
): AppError {
  for (const translator of translators) {
    const translated = translator.translate(error);
    if (translated) return translated;
  }
  return new InternalError(error);
}

export interface ErrorHandlerOptions {
  responder: HttpResponder;
  logger: ILogger;
  /** Chỉ `false` ở development/test: thêm `details.debug` (tên, message, stack) cho lỗi 500. */
  exposeInternalErrors: boolean;
  translators?: readonly ErrorTranslator[];
  /** Sentry (T-035): CHỈ lỗi 5xx (devops.md §6.3). Thiếu ⇒ không báo. */
  reporter?: IErrorReporter;
}

/**
 * Error handler cuối chuỗi (security.md §6.1). Lỗi 5xx được log `error` kèm stack;
 * response không bao giờ chứa stack/message nội bộ ở production (security.md §6.7).
 */
export function globalErrorHandler(options: ErrorHandlerOptions): ErrorRequestHandler {
  const { responder, logger, exposeInternalErrors, translators } = options;
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const error = toAppError(err, translators);
    // Metrics `http_errors_total{code}` đọc ở `finish` (core/observability/metrics.ts).
    (res.locals as { errorCode?: string }).errorCode = error.code;
    const log = (req as { log?: ILogger }).log ?? logger;
    if (error.statusCode >= 500) {
      log.error({ err: error.cause ?? err, code: error.code }, 'http.unhandled_error');
      options.reporter?.capture(error.cause ?? err);
    } else if (!(err instanceof AppError) && !(err instanceof z.ZodError)) {
      // Lỗi client do thư viện ném (URIError, body-parser…) — warn, không phải error (L3).
      log.warn({ err, code: error.code }, 'http.client_error');
    }
    const body = responder.errorBody(error);
    if (exposeInternalErrors && error instanceof InternalError) {
      // CÙNG serializer allow-list với log (T-031 mục 0): không trả message/meta thô của lỗi DB.
      body.error.details = { debug: serializeError(error.cause, { includeStack: true }) };
    }
    res.status(error.statusCode).set(error.headers).json(body);
  };
}

/** Route không tồn tại ⇒ 404 cùng envelope (đặt sau mọi router, trước error handler). */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new ResourceNotFoundError('route'));
};
