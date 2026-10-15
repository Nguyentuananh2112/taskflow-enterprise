import type { DbProvider } from './db';

// TODO(T-018): thay bản sao cục bộ bằng `import type { IUserRefReader, UserRef } from '../../../../task'`
// khi feat/T-018 merge (chữ ký đã chốt với C — modules/task/index.ts, type-only).
export interface UserRef {
  id: string;
  fullName: string;
}
export interface IUserRefReader {
  findRefs(ids: readonly string[]): Promise<ReadonlyMap<string, UserRef>>;
}

/**
 * Tên người dùng cho TaskDto/AuditLogDto (module Task). Đọc bảng `users` = hạ tầng của auth.
 * User đã ẩn danh hóa VẪN trả về (full_name đã là "Người dùng đã xóa" — D2); id không tồn tại
 * thì không có trong Map. Danh sách rỗng ⇒ không query.
 */
export class PrismaUserRefReader implements IUserRefReader {
  constructor(private readonly db: DbProvider) {}

  async findRefs(ids: readonly string[]): Promise<ReadonlyMap<string, UserRef>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db().user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }
}
