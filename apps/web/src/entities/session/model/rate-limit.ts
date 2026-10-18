import { isApiError } from '@/shared/api';

/** 429 khi khôi phục phiên: chờ `retryAfterSec` của server (thiếu ⇒ 30 s) — KHÔNG coi là mất mạng (lỗi #5). */
export function retryAfterOf(error: unknown): number {
  const sec = isApiError(error)
    ? (error.details as { retryAfterSec?: unknown } | null)?.retryAfterSec
    : undefined;
  return typeof sec === 'number' && sec > 0 ? Math.ceil(sec) : 30;
}
