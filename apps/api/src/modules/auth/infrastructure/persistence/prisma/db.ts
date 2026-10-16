import type { Prisma } from '../../../../../generated/prisma/client';

/** Client repository dùng: transaction đang mở hoặc client gốc. */
export type Db = Prisma.TransactionClient;

/**
 * = `uow.db()` của `PrismaUnitOfWork` (T-009). Repository KHÔNG tự mở transaction — luôn lấy client
 * hiện hành qua hàm này để chạy chung transaction của use case (ADR-012).
 */
export type DbProvider = () => Db;

/** Lỗi unique ⇒ tên constraint (P2002 lẫn SQL thô P2010/23505) — helper dùng chung ở `core`. */
export { uniqueConstraintOf } from '../../../../../core/persistence/unique-constraint';
