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
  createdAt: Date;
  updatedAt: Date;
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
  get isDeleted(): boolean {
    return this.s.deletedAt !== null;
  }
  get deletedAt(): Date | null {
    return this.s.deletedAt;
  }
  get purgeAt(): Date | null {
    return this.s.purgeAt;
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
