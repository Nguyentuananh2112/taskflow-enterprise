/**
 * Băm/kiểm mật khẩu (security.md 1.2, 6.5). Adapter PHẢI chuẩn hóa NFC bên trong cả `hash` lẫn
 * `verify` để use case không thể quên.
 */
export interface IPasswordHasher {
  hash(password: string): Promise<string>;

  /**
   * `hashed = null` (user không tồn tại / đã xóa) ⇒ vẫn verify với một hash giả cùng tham số rồi
   * trả `false`, để thời gian phản hồi không lộ email nào đã đăng ký (security.md 1.2 bước 3).
   */
  verify(hashed: string | null, password: string): Promise<boolean>;

  /** `true` khi hash được tạo bằng tham số khác cấu hình hiện tại ⇒ nên băm lại sau login đúng. */
  needsRehash(hashed: string): boolean;
}
