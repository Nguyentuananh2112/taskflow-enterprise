import type { Prisma } from '../../../../../generated/prisma/client';

/** Client repository dùng: transaction đang mở hoặc client gốc. */
export type Db = Prisma.TransactionClient;

/** = `uow.db()` của `PrismaUnitOfWork` — repository không tự mở transaction (ADR-012). */
export type DbProvider = () => Db;

/**
 * Tên constraint của lỗi unique (Prisma 7 + adapter-pg: `meta.driverAdapterError.cause.constraint.index`,
 * không có `meta.target`). Bản sao có chủ đích của helper bên workspace/auth — module không import
 * runtime của nhau (ADR-093).
 */
export function uniqueConstraintOf(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || (err as { code?: unknown }).code !== 'P2002') {
    return null;
  }
  const meta = (
    err as { meta?: { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } } }
  ).meta;
  const index = meta?.driverAdapterError?.cause?.constraint?.index;
  return typeof index === 'string' ? index : null;
}

/** Ngày thuần (D10) ⇄ cột `DATE` (Prisma trả `Date` lúc 00:00 UTC). */
export const toDateOnly = (d: Date | null): string | null =>
  d === null ? null : d.toISOString().slice(0, 10);
export const fromDateOnly = (s: string | null): Date | null =>
  s === null ? null : new Date(`${s}T00:00:00.000Z`);
