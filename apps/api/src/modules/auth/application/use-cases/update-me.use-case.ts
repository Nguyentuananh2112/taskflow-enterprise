import type { IClock } from '../../../../core/domain';
import { UnauthorizedError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { toUserView, type UserView } from '../auth-shared';
import type { IUserRepository } from '../ports/user-repository.port';

/**
 * `PATCH /auth/me` (ADR-083): CHỈ đổi họ tên của chính mình. Use case đọc đúng một trường từ input —
 * không spread — nên field lạ không thể lọt vào (ME-03; Zod strict ở presentation là lớp đầu).
 */
export class UpdateMeUseCase {
  constructor(private readonly d: { users: IUserRepository; uow: IUnitOfWork; clock: IClock }) {}

  execute(input: { userId: string; fullName: string }): Promise<UserView> {
    return this.d.uow.run(async () => {
      const user = await this.d.users.findById(input.userId);
      if (!user || user.isDeleted) throw new UnauthorizedError();
      user.rename(input.fullName, this.d.clock.now());
      await this.d.users.save(user);
      return toUserView(user);
    });
  }
}
