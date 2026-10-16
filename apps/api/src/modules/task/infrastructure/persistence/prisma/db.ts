import type { Prisma } from '../../../../../generated/prisma/client';

/** Client repository dùng: transaction đang mở hoặc client gốc. */
export type Db = Prisma.TransactionClient;

/** = `uow.db()` của `PrismaUnitOfWork` — repository không tự mở transaction (ADR-012). */
export type DbProvider = () => Db;

/**
 * Tên constraint của lỗi unique (Prisma 7 + adapter-pg: `meta.driverAdapterError.cause.constraint.index`,
 * không có `meta.target`). Bản sao có chủ đích của helper bên workspace/auth — module không import
 * runtime của nhau (ADR-093).
 *
 * A3: câu SQL thô (`$executeRaw`, vd `saveRanks`) vi phạm unique ⇒ Prisma trả `P2010` (raw query
 * failed) chứ không `P2002`, cùng `meta` — nhận diện qua SQLSTATE `23505` (đo trên Postgres 18.6).
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

/** Ngày thuần (D10) ⇄ cột `DATE` (Prisma trả `Date` lúc 00:00 UTC). */
export const toDateOnly = (d: Date | null): string | null =>
  d === null ? null : d.toISOString().slice(0, 10);
export const fromDateOnly = (s: string | null): Date | null =>
  s === null ? null : new Date(`${s}T00:00:00.000Z`);
