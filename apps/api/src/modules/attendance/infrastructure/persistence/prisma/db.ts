import type { Prisma } from '../../../../../generated/prisma/client';

/** Client repository dùng: transaction đang mở hoặc client gốc. */
export type Db = Prisma.TransactionClient;

/** = `uow.db()` của `PrismaUnitOfWork` — repository không tự mở transaction (ADR-012). */
export type DbProvider = () => Db;

/** Lỗi unique ⇒ tên constraint (P2002 lẫn SQL thô P2010/23505) — helper dùng chung ở `core`. */
export { uniqueConstraintOf } from '../../../../../core/persistence/unique-constraint';

/** Ngày thuần `YYYY-MM-DD` ⇄ cột `DATE` (Prisma trả `Date` lúc 00:00 UTC). */
export const toDateOnly = (d: Date): string => d.toISOString().slice(0, 10);
export const fromDateOnly = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
