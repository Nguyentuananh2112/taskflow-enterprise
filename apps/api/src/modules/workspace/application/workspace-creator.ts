import type { IClock, IIdGenerator } from '../../../core/domain';
import { ResourceConflictError } from '../../../core/errors';
import { Membership } from '../domain/membership';
import { Workspace } from '../domain/workspace';
import type { IMembershipRepository, IWorkspaceRepository } from './ports/repositories.port';
import { isReservedSlug } from './slug-rules';

export interface WorkspaceCreatorDeps {
  workspaces: IWorkspaceRepository;
  memberships: IMembershipRepository;
  ids: IIdGenerator;
  clock: IClock;
}

export function slugConflict(): ResourceConflictError {
  return new ResourceConflictError({ reason: 'taken', field: 'slug' });
}

export function isSlugConflict(err: unknown): boolean {
  return err instanceof ResourceConflictError && err.details?.['field'] === 'slug';
}

/**
 * Tạo workspace + membership OWNER (dùng chung cho CreateWorkspace và Register/provisioner).
 * Gọi BÊN TRONG `uow.run`. Slug dành riêng ⇒ cùng lỗi với slug đã có người dùng (WSC-08).
 */
export class WorkspaceCreator {
  constructor(private readonly d: WorkspaceCreatorDeps) {}

  async createWithOwner(input: { name: string; slug: string; ownerId: string }): Promise<{
    workspace: Workspace;
    owner: Membership;
  }> {
    const now = this.d.clock.now();
    const workspace = Workspace.create({
      id: this.d.ids.next(),
      name: input.name,
      slug: input.slug,
      now,
    });
    if (isReservedSlug(workspace.slug)) throw slugConflict();
    await this.d.workspaces.add(workspace); // trùng slug (kể cả ws đang xóa mềm) ⇒ slugConflict
    const owner = Membership.create({
      id: this.d.ids.next(),
      workspaceId: workspace.id,
      userId: input.ownerId,
      role: 'OWNER',
      now,
    });
    await this.d.memberships.add(owner);
    return { workspace, owner };
  }
}
