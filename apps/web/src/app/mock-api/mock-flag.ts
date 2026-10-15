type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Mock API chỉ bật khi `APP_MOCK_API=1` VÀ không phải staging/production — một image lỡ đặt cờ
 * ở môi trường thật cũng không mở mock (mock chấp nhận mọi mật khẩu đã đăng ký trong bộ nhớ).
 */
export function isMockApiEnabled(env: EnvSource = process.env): boolean {
  return env.APP_MOCK_API === '1' && env.APP_ENV !== 'staging' && env.APP_ENV !== 'production';
}
