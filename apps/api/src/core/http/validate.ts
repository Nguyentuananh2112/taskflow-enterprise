import type { RequestHandler } from 'express';
import type * as z from 'zod';

import { validationErrorFromZod } from './zod';

export interface RequestSchemas {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
}

type Out<S> = S extends z.ZodType ? z.output<S> : unknown;

/** Kiểu `Request` sau `validate(schemas)` — dùng làm generic cho handler. */
export type ValidatedRequestHandler<S extends RequestSchemas> = RequestHandler<
  Out<S['params']> & Record<string, string>,
  unknown,
  Out<S['body']>,
  Out<S['query']>
>;

/**
 * Validate `params` → `query` → `body` bằng Zod và **thay** giá trị gốc bằng bản đã parse
 * (đã coerce/strip). Sai ⇒ `ValidationError` (400) qua error handler.
 *
 * Express 5: `req.query` là getter chỉ đọc ⇒ ghi đè bằng thuộc tính riêng của `req`.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        next(validationErrorFromZod(result.error));
        return;
      }
      Object.defineProperty(req, part, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    next();
  };
}
