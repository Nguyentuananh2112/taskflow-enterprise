import type { IClock } from '../../../../core/domain';
import { ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { IWorkspaceRepository } from '../ports/repositories.port';
import { isReservedSlug } from '../slug-rules';
import { slugConflict } from '../workspace-creator';
import {
  requirePermission,
  toWorkspaceView,
  type Actor,
  type WorkspaceView,
} from '../workspace-shared';

/** `PATCH /workspaces/:wsId` — OWNER (`workspace:update`), body `{ name?, slug? }` (≥ 1 trường). */
export class UpdateWorkspaceUseCase {
  constructor(
    private readonly d: { workspaces: IWorkspaceRepository; uow: IUnitOfWork; clock: IClock },
  ) {}

  async execute(actor: Actor, input: { name?: string; slug?: string }): Promise<WorkspaceView> {
    requirePermission(actor, 'workspace:update');
    if (input.name === undefined && input.slug === undefined) {
      throw new ValidationError([
        { path: [], code: 'too_small', message: 'Cần ít nhất một trường để cập nhật.' },
      ]);
    }
    return this.d.uow.run(async () => {
      const ws = await this.d.workspaces.findById(actor.workspaceId);
      if (!ws || ws.isDeleted) throw new ResourceNotFoundError('workspace');
      const now = this.d.clock.now();
      if (input.name !== undefined) ws.rename(input.name, now);
      if (input.slug !== undefined && input.slug !== ws.slug) {
        ws.changeSlug(input.slug, now); // định dạng sai ⇒ 400
        if (isReservedSlug(input.slug)) throw slugConflict(); // cùng lỗi với slug đã có người dùng
      }
      await this.d.workspaces.save(ws); // trùng slug ⇒ 409 từ unique constraint
      return toWorkspaceView(ws.toSnapshot(), actor.role);
    });
  }
}
