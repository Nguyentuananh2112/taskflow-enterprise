import type { Email } from '../../domain/email';
import type { User } from '../../domain/user';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  /**
   * Thêm user mới. Email trùng ⇒ ném `EmailAlreadyExistsError` từ **unique constraint** (không
   * SELECT trước — chống race, REG-03).
   */
  add(user: User): Promise<void>;
  save(user: User): Promise<void>;
  /** Fallback cho `authenticate` khi cache lỗi/miss. `null` nếu user không tồn tại hoặc đã xóa. */
  getTokenVersion(userId: string): Promise<number | null>;
}
