import * as z from 'zod';

import { decodeCursor, encodeCursor } from './cursor';
import type { PageMeta } from './envelope';

// Mọi keyset hiện tại theo id (uuid) — kiểm ngay ở helper chung (gợi ý của B, X5 T-032).
const AfterKey = z.object({ after: z.uuid() });

/**
 * Cầu nối cursor opaque của API (data-and-api §3.1) ↔ `after`/`nextAfter` của query application.
 * `kind` gắn cursor với endpoint: cursor của danh sách thành viên không dùng được cho project.
 */
export function afterFromCursor(kind: string, cursor: string | undefined): string | undefined {
  return cursor === undefined ? undefined : decodeCursor(cursor, kind, AfterKey).after;
}

export function pageMeta(kind: string, nextAfter: string | null, limit: number): PageMeta {
  return {
    nextCursor: nextAfter === null ? null : encodeCursor(kind, { after: nextAfter }),
    hasMore: nextAfter !== null,
    limit,
  };
}
