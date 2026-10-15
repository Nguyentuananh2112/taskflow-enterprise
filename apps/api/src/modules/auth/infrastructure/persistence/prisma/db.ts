import type { Prisma } from '../../../../../generated/prisma/client';

/** Client repository dùng: transaction đang mở hoặc client gốc. */
export type Db = Prisma.TransactionClient;

/**
 * = `uow.db()` của `PrismaUnitOfWork` (T-009). Repository KHÔNG tự mở transaction — luôn lấy client
 * hiện hành qua hàm này để chạy chung transaction của use case (ADR-012).
 */
export type DbProvider = () => Db;

/**
 * Tên constraint của lỗi unique. Prisma 7 + `@prisma/adapter-pg` KHÔNG có `meta.target`; tên nằm ở
 * `meta.driverAdapterError.cause.constraint.index` (đã kiểm trên Postgres 18.6 — T-020 report).
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
