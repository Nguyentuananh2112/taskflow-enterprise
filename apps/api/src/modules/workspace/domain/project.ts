import { Entity } from '../../../core/domain';
import { ProjectArchivedError, ValidationError } from '../../../core/errors';
import { normalizeName } from './names';

const KEY_PREFIX = /^[A-Z][A-Z0-9]{1,9}$/; // R17
const DESCRIPTION_MAX = 2000; // projects.description VarChar(2000)

export interface ProjectSnapshot {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  description: string | null;
  nextTaskNumber: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function normalizeDescription(raw: string | null): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  if ([...value].length > DESCRIPTION_MAX) {
    throw new ValidationError([
      { path: ['description'], code: 'too_big', message: `Mô tả tối đa ${DESCRIPTION_MAX} ký tự.` },
    ]);
  }
  return value;
}

/**
 * Project (FR-03). `keyPrefix` bất biến (R17). `nextTaskNumber` do module Task tăng bằng
 * `UPDATE … RETURNING` trong transaction — entity ở đây chỉ giữ giá trị.
 */
export class Project extends Entity {
  private constructor(private readonly s: ProjectSnapshot) {
    super(s.id);
  }

  static create(input: {
    id: string;
    workspaceId: string;
    name: string;
    keyPrefix: string;
    description: string | null;
    now: Date;
  }): Project {
    if (!KEY_PREFIX.test(input.keyPrefix)) {
      throw new ValidationError([
        {
          path: ['keyPrefix'],
          code: 'invalid_format',
          message: 'Mã dự án gồm 2–10 ký tự in hoa/số, bắt đầu bằng chữ cái.',
        },
      ]);
    }
    return new Project({
      id: input.id,
      workspaceId: input.workspaceId,
      name: normalizeName(input.name, 'name'),
      keyPrefix: input.keyPrefix,
      description: normalizeDescription(input.description),
      nextTaskNumber: 1,
      archivedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static reconstitute(snapshot: ProjectSnapshot): Project {
    return new Project({ ...snapshot });
  }

  get workspaceId(): string {
    return this.s.workspaceId;
  }
  get keyPrefix(): string {
    return this.s.keyPrefix;
  }
  get isArchived(): boolean {
    return this.s.archivedAt !== null;
  }

  /** Project archived chỉ đọc (ADR-023): sửa ⇒ 422 PROJECT_ARCHIVED. */
  update(changes: { name?: string; description?: string | null }, now: Date): void {
    if (this.isArchived) throw new ProjectArchivedError(this.id);
    if (changes.name !== undefined) this.s.name = normalizeName(changes.name, 'name');
    if (changes.description !== undefined) {
      this.s.description = normalizeDescription(changes.description);
    }
    this.s.updatedAt = now;
  }

  /** Idempotent: `false` nếu đã archive (giữ archivedAt lần đầu — ARC-02). */
  archive(now: Date): boolean {
    if (this.isArchived) return false;
    this.s.archivedAt = now;
    this.s.updatedAt = now;
    return true;
  }

  unarchive(now: Date): boolean {
    if (!this.isArchived) return false;
    this.s.archivedAt = null;
    this.s.updatedAt = now;
    return true;
  }

  toSnapshot(): ProjectSnapshot {
    return { ...this.s };
  }
}
