import type { Email } from '../../domain/email';
import type { User } from '../../domain/user';

/**
 * ADR-104 (chống lost update — finding A4 của QA): KHÔNG có `save(user)` tổng quát cho user đã tồn
 * tại. Mỗi thay đổi là MỘT câu lệnh nguyên tử theo mục đích; aggregate `User` vẫn kiểm luật, repository
 * chỉ thực thi ý định. Các lệnh có điều kiện trả `false`/`null` khi điều kiện không còn đúng.
 */
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  /**
   * Thêm user mới. Email trùng ⇒ ném `EmailAlreadyExistsError` từ **unique constraint** (không
   * SELECT trước — chống race, REG-03).
   */
  add(user: User): Promise<void>;
  /** Fallback cho `authenticate` khi cache lỗi/miss. `null` nếu user không tồn tại hoặc đã xóa. */
  getTokenVersion(userId: string): Promise<number | null>;
  /**
   * Trong transaction refresh: `SELECT token_version … WHERE id AND deleted_at IS NULL FOR SHARE`
   * (X4, T-032). Khóa chia sẻ ⇒ `bumpTokenVersion` / `changePassword` đồng thời phải chờ refresh
   * commit, nên `revokeAllForUser` sau đó thấy được token mới. `null` nếu không có / đã xóa.
   */
  lockTokenVersion(userId: string): Promise<number | null>;

  /**
   * Chỉ `last_login_at`, có điều kiện user chưa xóa **và `password_hash = expectedHash`** (hash vừa verify,
   * hoặc hash mới nếu login vừa băm lại thành công). Trả `token_version` HIỆN TẠI để ký access token.
   * `null` ⇒ user không còn, hoặc mật khẩu đã bị đổi trong lúc verify (G1 auth M1): login KHÔNG được
   * nhận phiên — `revokeAllForUser` của lần đổi đã chạy xong, phiên tạo sau đó sẽ sống sót.
   */
  recordLogin(input: { id: string; expectedHash: string; at: Date }): Promise<number | null>;
  /** Băm lại khi tham số argon2 đổi: chỉ khi `password_hash = oldHash` (thua race ⇒ `false`, bỏ qua). */
  rehashPassword(input: {
    id: string;
    oldHash: string;
    newHash: string;
    at: Date;
  }): Promise<boolean>;
  /**
   * Đổi mật khẩu có điều kiện `password_hash = oldHash` + `token_version + 1` trong CÙNG câu lệnh,
   * `RETURNING token_version`. `null` ⇒ mật khẩu đã bị đổi trước đó / user không còn.
   */
  changePassword(input: {
    id: string;
    oldHash: string;
    newHash: string;
    at: Date;
  }): Promise<number | null>;
  /**
   * Kích hoạt (ADR-137): đặt mật khẩu ĐẦU TIÊN, có điều kiện `password_hash IS NULL` và chưa xóa;
   * `RETURNING token_version`. `null` ⇒ đã có mật khẩu (kích hoạt đồng thời thua) / user không còn.
   */
  setInitialPassword(input: { id: string; hash: string; at: Date }): Promise<number | null>;
  /** `token_version + 1 RETURNING token_version` (đăng xuất mọi thiết bị). `null` ⇒ user không còn. */
  bumpTokenVersion(id: string, at: Date): Promise<number | null>;
  /** Chỉ `full_name` (đã chuẩn hóa bởi aggregate). `false` ⇒ user không còn. */
  updateProfile(input: { id: string; fullName: string; at: Date }): Promise<boolean>;
}
