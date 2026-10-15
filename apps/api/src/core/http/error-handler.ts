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
import type { ILogger } from '../logging/logger';
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

export const DEFAULT_TRANSLATORS: readonly ErrorTranslator[] = [
  appErrors,
  zodErrors,
  bodyParserErrors,
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
    const log = (req as { log?: ILogger }).log ?? logger;
    if (error.statusCode >= 500) {
      log.error({ err: error.cause ?? err, code: error.code }, 'http.unhandled_error');
    }
    const body = responder.errorBody(error);
    if (exposeInternalErrors && error instanceof InternalError) {
      const cause = error.cause instanceof Error ? error.cause : undefined;
      body.error.details = {
        debug: { name: cause?.name, message: cause?.message, stack: cause?.stack },
      };
    }
    res.status(error.statusCode).set(error.headers).json(body);
  };
}

/** Route không tồn tại ⇒ 404 cùng envelope (đặt sau mọi router, trước error handler). */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new ResourceNotFoundError('route'));
};
