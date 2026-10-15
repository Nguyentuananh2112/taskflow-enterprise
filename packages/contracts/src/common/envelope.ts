import * as z from 'zod';

import { ErrorCode } from './error-codes';
import { IsoDateTime } from './primitives';

/** `meta.page` cho endpoint danh sách (data-and-api §3.1). */
export const PageMeta = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  limit: z.int().min(1),
});
export type PageMeta = z.infer<typeof PageMeta>;

export const ApiMeta = z.object({
  timestamp: IsoDateTime,
  requestId: z.string().min(1),
  page: PageMeta.optional(),
});
export type ApiMeta = z.infer<typeof ApiMeta>;

/** Envelope thành công bọc schema `data`. */
export function apiSuccess<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data, meta: ApiMeta });
}
export type ApiSuccess<T> = { success: true; data: T; meta: ApiMeta };

export const ApiErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.unknown().nullable(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const ApiError = z.object({
  success: z.literal(false),
  error: ApiErrorBody,
  meta: ApiMeta.omit({ page: true }),
});
export type ApiError = z.infer<typeof ApiError>;

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
