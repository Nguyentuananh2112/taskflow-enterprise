import type { IRandom } from '../../../../core/domain';
import { InternalError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { assertSlugFormat, normalizeName } from '../../domain/names';
import { MAX_SLUG_ATTEMPTS, generateSlug } from '../slug-rules';
import { isSlugConflict, type WorkspaceCreator } from '../workspace-creator';
import { toWorkspaceView, type WorkspaceView } from '../workspace-shared';

export interface CreateWorkspaceInput {
  userId: string;
  name: string;
  slug?: string | undefined;
}

/** `POST /workspaces` — chỉ cần đăng nhập; người tạo thành OWNER (R19, ADR-094). */
export class CreateWorkspaceUseCase {
  constructor(
    private readonly d: { creator: WorkspaceCreator; uow: IUnitOfWork; random: IRandom },
  ) {}

  async execute(input: CreateWorkspaceInput): Promise<WorkspaceView> {
    const name = normalizeName(input.name, 'name'); // lỗi định dạng trước khi mở transaction
    if (input.slug !== undefined) {
      assertSlugFormat(input.slug);
      return this.#create(name, input.slug, input.userId);
    }
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      try {
        return await this.#create(name, generateSlug(name, attempt, this.d.random), input.userId);
      } catch (err) {
        if (!isSlugConflict(err)) throw err;
      }
    }
    throw new InternalError(new Error(`Hết ${MAX_SLUG_ATTEMPTS} lần thử slug khi tạo workspace`));
  }

  #create(name: string, slug: string, ownerId: string): Promise<WorkspaceView> {
    // Slug client gửi mà trùng ⇒ 409 ngay, không thử lại (chỉ slug tự sinh mới thử lại).
    return this.d.uow.run(async () => {
      const { workspace } = await this.d.creator.createWithOwner({ name, slug, ownerId });
      return toWorkspaceView(workspace.toSnapshot(), 'OWNER');
    });
  }
}
