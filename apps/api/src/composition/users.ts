// Cầu nối giữa module auth (sở hữu user) và Workspace (cần tra user) — chỉ ở composition root,
// module không import nội bộ nhau (ADR-093).
import type { IUserRepository } from '../modules/auth/application/ports/user-repository.port';
import { Email } from '../modules/auth/domain/email';
import type { User } from '../modules/auth/domain/user';
import type {
  IUserDirectory,
  UserSummary,
} from '../modules/workspace/application/ports/collaborators.port';

const summaryOf = (user: User | null): UserSummary | null =>
  user && !user.isDeleted
    ? { id: user.id, email: user.email.value, fullName: user.fullName }
    : null;

/** `IUserDirectory` của Workspace trên repository user của auth; user đã xóa ⇒ coi như không có. */
export class AuthUserDirectory implements IUserDirectory {
  constructor(private readonly users: IUserRepository) {}

  async findByEmail(normalizedEmail: string): Promise<UserSummary | null> {
    let email: Email;
    try {
      email = Email.create(normalizedEmail);
    } catch {
      return null;
    }
    return summaryOf(await this.users.findByEmail(email));
  }

  async findById(id: string): Promise<UserSummary | null> {
    return summaryOf(await this.users.findById(id));
  }
}

/** Đích ghi bản sao user cho truy vấn danh sách thành viên InMemory. */
export interface UserMirror {
  users: Map<string, UserSummary>;
}

/**
 * Chế độ bộ nhớ: query thành viên InMemory của Workspace đọc tên/email từ một bản sao riêng ⇒ mọi
 * lần ghi user của auth được phản chiếu sang (Prisma join bảng users nên không cần lớp này).
 */
export class MirroringUserRepository implements IUserRepository {
  constructor(
    private readonly inner: IUserRepository,
    private readonly mirror: UserMirror,
    /** Bản sao khác cần cập nhật (vd user của InMemoryTaskDatabase — tên trong UserRef của task). */
    private readonly onWrite: (user: User) => void = () => undefined,
  ) {}

  #reflect(user: User): void {
    const summary = summaryOf(user);
    if (summary) this.mirror.users.set(user.id, summary);
    else this.mirror.users.delete(user.id);
    this.onWrite(user);
  }

  findById(id: string) {
    return this.inner.findById(id);
  }

  findByEmail(email: Email) {
    return this.inner.findByEmail(email);
  }

  async add(user: User): Promise<void> {
    await this.inner.add(user);
    this.#reflect(user);
  }

  // ADR-104 (T-020): lệnh intent thay cho save(user). Chỉ updateProfile đổi dữ liệu mà bản sao cần.
  // TODO(D2 ẩn danh hóa user): lệnh soft-delete tương lai PHẢI gọi #reflect (bản sao loại user đã xóa).
  recordLogin(id: string, at: Date) {
    return this.inner.recordLogin(id, at);
  }

  rehashPassword(input: Parameters<IUserRepository['rehashPassword']>[0]) {
    return this.inner.rehashPassword(input);
  }

  changePassword(input: Parameters<IUserRepository['changePassword']>[0]) {
    return this.inner.changePassword(input);
  }

  bumpTokenVersion(id: string, at: Date) {
    return this.inner.bumpTokenVersion(id, at);
  }

  async updateProfile(input: Parameters<IUserRepository['updateProfile']>[0]): Promise<boolean> {
    const updated = await this.inner.updateProfile(input);
    const user = updated ? await this.inner.findById(input.id) : null;
    if (user) this.#reflect(user);
    return updated;
  }

  getTokenVersion(userId: string) {
    return this.inner.getTokenVersion(userId);
  }
  lockTokenVersion(userId: string) {
    return this.inner.lockTokenVersion(userId);
  }
}
