import type { Prisma } from '../../../../../generated/prisma/client';

/** Client repository dùng: transaction đang mở hoặc client gốc. */
export type Db = Prisma.TransactionClient;

/** = `uow.db()` của `PrismaUnitOfWork` (T-009) — repository không tự mở transaction (ADR-012). */
export type DbProvider = () => Db;

/**
 * Tên constraint của lỗi unique (Prisma 7 + adapter-pg: `meta.driverAdapterError.cause.constraint.index`,
 * không có `meta.target`). Bản sao có chủ đích của helper bên auth — module không import runtime lẫn nhau.
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

/** Map tên constraint ⇒ lỗi 409 của contract (data-and-api 3.2). */
export const CONFLICTS: Readonly<Record<string, { reason: string; field?: string }>> = {
  workspaces_slug_key: { reason: 'taken', field: 'slug' },
  projects_workspace_id_key_prefix_key: { reason: 'taken', field: 'keyPrefix' },
  workspace_members_workspace_id_user_id_key: { reason: 'already_member' },
};
