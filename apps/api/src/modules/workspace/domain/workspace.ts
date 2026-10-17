import { Entity } from '../../../core/domain';
import { assertSlugFormat, normalizeName } from './names';

/** ADR-047: xóa mềm, khôi phục được trong 30 ngày rồi job purge xóa cứng. */
export const WORKSPACE_PURGE_GRACE_MS = 30 * 86_400_000;

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  slug: string;
  deletedAt: Date | null;
  purgeAt: Date | null;
  deletedById: string | null;
  /** ADR-110: optimistic lock — repository ghi `WHERE version = ?` rồi tăng. */
  version: number;
  /** Mốc 3.5 (ADR-134): Admin lưu trữ ws mồ côi 0 thành viên — chỉ ghi qua `IWorkspaceRepository.archive`. */
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Workspace MỒ CÔI (company-level ADR-134): còn sống (chưa xóa mềm, chưa lưu trữ) mà không còn OWNER nào — xảy ra khi
 * OWNER duy nhất nghỉ việc / bị gỡ. Admin giao OWNER cho thành viên còn lại hoặc lưu trữ khi 0 thành viên. Hàm thuần —
 * T-061a (`/admin/workspaces`) và T-062 (hoàn tất nghỉ việc) dùng chung.
 */
export function isOrphanWorkspace(w: {
  deletedAt: Date | null;
  archivedAt?: Date | null | undefined;
  ownerCount: number;
}): boolean {
  return w.deletedAt === null && (w.archivedAt ?? null) === null && w.ownerCount === 0;
}

export class Workspace extends Entity {
  private constructor(private readonly s: WorkspaceSnapshot) {
    super(s.id);
  }

  static create(input: { id: string; name: string; slug: string; now: Date }): Workspace {
    assertSlugFormat(input.slug);
    return new Workspace({
      id: input.id,
      name: normalizeName(input.name, 'name'),
      slug: input.slug,
      deletedAt: null,
      purgeAt: null,
      deletedById: null,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static reconstitute(snapshot: WorkspaceSnapshot): Workspace {
    return new Workspace({ ...snapshot });
  }

  get name(): string {
    return this.s.name;
  }
  get slug(): string {
    return this.s.slug;
  }
  /** Mốc 3.5 (ADR-134): đã lưu trữ (ws mồ côi 0 thành viên). */
  get archivedAt(): Date | null {
    return this.s.archivedAt ?? null;
  }
  get isDeleted(): boolean {
    return this.s.deletedAt !== null;
  }
  get deletedAt(): Date | null {
    return this.s.deletedAt;
  }
  get purgeAt(): Date | null {
    return this.s.purgeAt;
  }
  get version(): number {
    return this.s.version;
  }
  get createdAt(): Date {
    return this.s.createdAt;
  }
  get updatedAt(): Date {
    return this.s.updatedAt;
  }

  rename(name: string, now: Date): void {
    this.s.name = normalizeName(name, 'name');
    this.s.updatedAt = now;
  }

  /** Kiểm định dạng; slug dành riêng / trùng là việc của application + unique constraint. */
  changeSlug(slug: string, now: Date): void {
    assertSlugFormat(slug);
    this.s.slug = slug;
    this.s.updatedAt = now;
  }

  softDelete(actorId: string, now: Date): void {
    this.s.deletedAt = now;
    this.s.purgeAt = new Date(now.getTime() + WORKSPACE_PURGE_GRACE_MS);
    this.s.deletedById = actorId;
    this.s.updatedAt = now;
  }

  /** Khôi phục thật đi qua UPDATE có điều kiện ở repository (chống race với purge — security.md 3.6). */
  isRestorable(now: Date): boolean {
    return this.s.purgeAt !== null && this.s.purgeAt.getTime() > now.getTime();
  }

  toSnapshot(): WorkspaceSnapshot {
    return { ...this.s };
  }
}
