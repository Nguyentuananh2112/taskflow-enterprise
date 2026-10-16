/**
 * Tên constraint của lỗi vi phạm UNIQUE (SQLSTATE `23505`), hoặc `null` nếu không phải lỗi unique.
 * Dùng chung cho mọi module (auth, workspace, task) — trước đây là 3 bản sao (ADR-093 cấm module
 * import nội bộ của nhau, nhưng `core` là kernel dùng chung).
 *
 * Prisma 7 + `@prisma/adapter-pg` (đã kiểm trên Postgres 18.6 — test integration `unique-constraint`):
 * - API model (`create`, `update`, `updateMany`…) ⇒ `code: 'P2002'`;
 * - SQL thô (`$executeRaw` / `$queryRaw`) ⇒ `code: 'P2010'` (raw query failed), SQLSTATE nằm ở
 *   `meta.driverAdapterError.cause.originalCode` — trước A3 chỉ nhận P2002 ⇒ unique từ SQL thô thành 500.
 * Cả hai: tên constraint ở `meta.driverAdapterError.cause.constraint.index` (không có `meta.target`).
 */
export function uniqueConstraintOf(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const { code, meta } = err as {
    code?: unknown;
    meta?: {
      driverAdapterError?: { cause?: { originalCode?: unknown; constraint?: { index?: unknown } } };
    };
  };
  const cause = meta?.driverAdapterError?.cause;
  const unique = code === 'P2002' || (code === 'P2010' && cause?.originalCode === '23505');
  const index = cause?.constraint?.index;
  return unique && typeof index === 'string' ? index : null;
}
