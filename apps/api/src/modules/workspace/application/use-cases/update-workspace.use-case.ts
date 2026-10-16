import type { IClock } from '../../../../core/domain';
import { ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { saveWorkspaceOrFail } from '../optimistic-save';
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
    private readonly d: {
      workspaces: IWorkspaceRepository;
      uow: IUnitOfWork;
      clock: IClock;
      logger: ILogger;
    },
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
        const from = ws.slug;
        ws.changeSlug(input.slug, now); // định dạng sai ⇒ 400
        // Sự kiện bảo mật (X9): slug là định danh công khai của ws (link, xác nhận xóa).
        this.d.uow.afterCommit(() => {
          this.d.logger.info(
            { workspaceId: ws.id, actorId: actor.userId, from, to: ws.slug },
            'workspace.slug_changed',
          );
        });
        if (isReservedSlug(input.slug)) throw slugConflict(); // cùng lỗi với slug đã có người dùng
      }
      // ADR-110: có điều kiện version + chưa xóa (X2). Trùng slug ⇒ 409 từ unique constraint.
      await saveWorkspaceOrFail(this.d.workspaces, ws);
      return toWorkspaceView(ws.toSnapshot(), actor.role, actor.grants);
    });
  }
}
