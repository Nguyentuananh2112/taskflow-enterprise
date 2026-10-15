import * as z from 'zod';

// TODO(T-010): FILE TẠM — thay bằng import envelope + ErrorCode từ @taskflow/contracts khi T-010 merge
// (Tech Lead đã duyệt). Chỉ mô tả VỎ envelope (data-and-api.md §3.1) đủ để http client tách
// thành công/lỗi; `code` để dạng string cho tới khi có enum ErrorCode chính thức.

export const PageMeta = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  limit: z.number().int(),
});
export type PageMeta = z.infer<typeof PageMeta>;

const Meta = z.object({
  timestamp: z.string().optional(),
  requestId: z.string().optional(),
  page: PageMeta.optional(),
});

export const ApiSuccessEnvelope = z.object({
  success: z.literal(true),
  data: z.unknown(),
  meta: Meta.optional(),
});

export const ApiErrorEnvelope = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  meta: Meta.optional(),
});

export const ApiEnvelope = z.discriminatedUnion('success', [ApiSuccessEnvelope, ApiErrorEnvelope]);
export type ApiEnvelope = z.infer<typeof ApiEnvelope>;
