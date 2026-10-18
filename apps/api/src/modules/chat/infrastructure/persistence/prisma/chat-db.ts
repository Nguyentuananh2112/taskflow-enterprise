import { Prisma } from '../../../../../generated/prisma/client';

// Mảnh SQL dùng chung của các store chat Prisma (T-069a). Mọi giá trị là tham số (`Prisma.sql`), không nối chuỗi.

export type Db = Prisma.TransactionClient;
/** = `uow.db()` — repository không tự mở transaction (ADR-012). */
export type DbProvider = () => Db;

/** ILIKE an toàn: thoát `\ % _` (đi kèm `ESCAPE '\'`). */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * "Thuộc công ty hoạt động" (G 18/10 — một định nghĩa cho mọi chỗ) trên bí danh `cm` (company_members) + `u` (users)
 * đã JOIN: còn hạn truy cập, đã kích hoạt, chưa xóa.
 */
export const activeSql = (now: Date) => Prisma.sql`
  (cm.offboard_access_until IS NULL OR cm.offboard_access_until > ${now})
  AND u.password_hash IS NOT NULL AND u.deleted_at IS NULL`;

/**
 * (conversation_id, user_id) của MỌI người có quyền tại `now` (ADR-143): participant hiệu lực của DIRECT / GROUP +
 * thành viên ws hoạt động của phòng WORKSPACE (ws chưa xóa mềm / chưa lưu trữ). `where` lọc thêm trên bí danh `c`.
 */
export const accessSql = (now: Date, where: Prisma.Sql = Prisma.sql`TRUE`) => Prisma.sql`
  SELECT p.conversation_id, p.user_id
    FROM chat_participants p
    JOIN chat_conversations c ON c.id = p.conversation_id AND c.kind <> 'WORKSPACE'
    JOIN company_members cm ON cm.user_id = p.user_id
    JOIN users u ON u.id = p.user_id
   WHERE ${where} AND ${activeSql(now)}
     AND (c.kind = 'DIRECT' OR (p.left_at IS NULL AND p.joined_at >= cm.created_at))
  UNION ALL
  SELECT c.id, wm.user_id
    FROM chat_conversations c
    JOIN workspaces w ON w.id = c.workspace_id AND w.deleted_at IS NULL AND w.archived_at IS NULL
    JOIN workspace_members wm ON wm.workspace_id = w.id
    JOIN company_members cm ON cm.user_id = wm.user_id
    JOIN users u ON u.id = wm.user_id
   WHERE ${where} AND c.kind = 'WORKSPACE' AND ${activeSql(now)}`;

/** `effective` của một dòng participant `p` (cần `c` + LEFT JOIN `cm`, `u`). */
export const effectiveSql = (now: Date) => Prisma.sql`
  COALESCE(cm.user_id IS NOT NULL AND ${activeSql(now)}
    AND (c.kind = 'DIRECT' OR (p.left_at IS NULL AND p.joined_at >= cm.created_at)), FALSE)`;
