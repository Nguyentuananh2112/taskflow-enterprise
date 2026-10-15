type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Mock API chỉ bật khi `APP_MOCK_API=1` VÀ `APP_ENV` được đặt TƯỜNG MINH là local/test — một image
 * lỡ đặt cờ ở môi trường thật (hoặc quên đặt APP_ENV ⇒ coi là production, T-029) cũng không mở mock
 * (mock chấp nhận mọi mật khẩu đã đăng ký trong bộ nhớ).
 */
export function isMockApiEnabled(env: EnvSource = process.env): boolean {
  return env.APP_MOCK_API === '1' && (env.APP_ENV === 'local' || env.APP_ENV === 'test');
}
