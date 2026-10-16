import type { Prisma } from '../../../../../generated/prisma/client';

/** Client repository dùng: transaction đang mở hoặc client gốc. */
export type Db = Prisma.TransactionClient;

/** = `uow.db()` của `PrismaUnitOfWork` (T-009) — repository không tự mở transaction (ADR-012). */
export type DbProvider = () => Db;

/** Lỗi unique ⇒ tên constraint (P2002 lẫn SQL thô P2010/23505) — helper dùng chung ở `core`. */
export { uniqueConstraintOf } from '../../../../../core/persistence/unique-constraint';

/** Map tên constraint ⇒ lỗi 409 của contract (data-and-api 3.2). */
export const CONFLICTS: Readonly<Record<string, { reason: string; field?: string }>> = {
  workspaces_slug_key: { reason: 'taken', field: 'slug' },
  projects_workspace_id_key_prefix_key: { reason: 'taken', field: 'keyPrefix' },
  workspace_members_workspace_id_user_id_key: { reason: 'already_member' },
};
