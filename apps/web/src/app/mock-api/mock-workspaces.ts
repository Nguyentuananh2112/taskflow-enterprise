import type { WorkspaceRole } from '@taskflow/contracts/rbac';

// Workspace + thành viên của mock API (T-034). Một nguồn dữ liệu duy nhất: đổi tên/slug, xóa mềm,
// khôi phục thấy ngay ở mọi thành viên (trước T-034 mỗi membership giữ bản sao tên/slug).

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  purgeAt: string | null;
  /** Mốc 3.5: Admin lưu trữ workspace mồ côi không còn thành viên (ADR-134). */
  archivedAt?: string | null;
};
export type MemberRow = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: string;
};

/** ADR-094 / R19 — danh sách slug dành riêng (khớp apps/api slug-rules.ts). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api',
  'app',
  'www',
  'admin',
  'auth',
  'login',
  'register',
  'settings',
  'workspaces',
  'new',
  'help',
  'support',
  'status',
]);

const GRACE_MS = 30 * 86_400_000; // ADR-047: ân hạn 30 ngày

/** R19: bỏ dấu tiếng Việt, chữ thường, ký tự khác [a-z0-9] ⇒ '-', cắt 40. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export class MockWorkspaces {
  private readonly rows = new Map<string, WorkspaceRow>();
  private members: MemberRow[] = [];

  constructor(private readonly now: () => number) {}

  private iso(offset = 0): string {
    return new Date(this.now() + offset).toISOString();
  }

  /** Slug duy nhất toàn hệ thống, KỂ CẢ workspace đang xóa mềm (giữ chỗ trong ân hạn). */
  slugTaken(slug: string, exceptId?: string): boolean {
    return (
      RESERVED_SLUGS.has(slug) ||
      [...this.rows.values()].some((w) => w.slug === slug && w.id !== exceptId)
    );
  }

  /** Không gửi slug ⇒ sinh từ tên; trùng/ngắn/dành riêng ⇒ thêm hậu tố ngẫu nhiên (R19). */
  generateSlug(name: string): string {
    const base = slugify(name);
    const stem = base.length >= 3 && !RESERVED_SLUGS.has(base) ? base : 'workspace';
    if (stem === base && !this.slugTaken(base)) return base;
    for (;;) {
      const candidate = `${stem}-${crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`;
      if (!this.slugTaken(candidate)) return candidate;
    }
  }

  create(input: { name: string; slug: string }, ownerId: string): WorkspaceRow {
    const at = this.iso();
    const row: WorkspaceRow = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      purgeAt: null,
    };
    this.rows.set(row.id, row);
    this.setMember(row.id, ownerId, 'OWNER');
    return row;
  }

  /** Mọi workspace (kể cả đã xóa mềm) — `/admin/workspaces` (ADR-134). */
  all(): WorkspaceRow[] {
    return [...this.rows.values()];
  }

  archive(id: string): WorkspaceRow {
    return Object.assign(this.update(id, {}), { archivedAt: this.iso() });
  }

  /** Chưa xóa. */
  active(id: string): WorkspaceRow | undefined {
    const row = this.rows.get(id);
    return row && row.deletedAt === null ? row : undefined;
  }

  update(id: string, changes: { name?: string; slug?: string }): WorkspaceRow {
    const row = this.rows.get(id);
    if (!row) throw new Error('workspace không tồn tại');
    Object.assign(row, changes, { updatedAt: this.iso() });
    return row;
  }

  softDelete(id: string): WorkspaceRow {
    const row = this.update(id, {});
    row.deletedAt = this.iso();
    row.purgeAt = this.iso(GRACE_MS);
    return row;
  }

  /** OWNER của workspace đã xóa và còn trong ân hạn; ngược lại `undefined` (404 một kiểu — ADR-050). */
  restore(id: string, userId: string): WorkspaceRow | undefined {
    const row = this.rows.get(id);
    const owner = this.member(id, userId)?.role === 'OWNER';
    if (!row || row.deletedAt === null || !owner || (row.purgeAt ?? '') <= this.iso())
      return undefined;
    return Object.assign(row, { deletedAt: null, purgeAt: null, updatedAt: this.iso() });
  }

  member(workspaceId: string, userId: string): MemberRow | undefined {
    return this.members.find((m) => m.workspaceId === workspaceId && m.userId === userId);
  }

  /** Thành viên theo thứ tự tham gia. */
  membersOf(workspaceId: string): MemberRow[] {
    return this.members.filter((m) => m.workspaceId === workspaceId);
  }

  setMember(workspaceId: string, userId: string, role: WorkspaceRole): MemberRow {
    const existing = this.member(workspaceId, userId);
    if (existing) {
      return Object.assign(existing, { role });
    }
    const row: MemberRow = { workspaceId, userId, role, joinedAt: this.iso() };
    this.members.push(row);
    return row;
  }

  removeMember(workspaceId: string, userId: string): void {
    this.members = this.members.filter(
      (m) => !(m.workspaceId === workspaceId && m.userId === userId),
    );
  }

  /** Workspace CHƯA xóa mà user là thành viên. */
  activeOf(userId: string): Array<{ workspace: WorkspaceRow; member: MemberRow }> {
    return this.members.flatMap((member) => {
      const workspace = member.userId === userId ? this.active(member.workspaceId) : undefined;
      return workspace ? [{ workspace, member }] : [];
    });
  }

  /** `GET /workspaces?deleted=true`: workspace đã xóa mềm mà user là OWNER (ADR-050). */
  deletedOwnedBy(userId: string): WorkspaceRow[] {
    return this.members
      .filter((m) => m.userId === userId && m.role === 'OWNER')
      .flatMap((m) => {
        const row = this.rows.get(m.workspaceId);
        // Như server: chỉ workspace còn trong ân hạn (purgeAt > now), mới xóa trước.
        return row && row.deletedAt !== null && (row.purgeAt ?? '') > this.iso() ? [row] : [];
      })
      .sort((a, b) => ((a.deletedAt ?? '') < (b.deletedAt ?? '') ? 1 : -1));
  }
}
