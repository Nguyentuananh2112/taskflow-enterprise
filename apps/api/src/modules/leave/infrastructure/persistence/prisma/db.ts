import type { Prisma } from '../../../../../generated/prisma/client';

/** Client repository dùng: transaction đang mở hoặc client gốc (= `uow.db()` — ADR-012). */
export type Db = Prisma.TransactionClient;
export type DbProvider = () => Db;

/** Ngày thuần `YYYY-MM-DD` ⇄ cột `DATE` (Prisma trả `Date` lúc 00:00 UTC — D10). */
export const toDateOnly = (d: Date): string => d.toISOString().slice(0, 10);
export const fromDateOnly = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
