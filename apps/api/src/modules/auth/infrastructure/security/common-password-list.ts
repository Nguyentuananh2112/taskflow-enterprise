// Nguồn, cách lọc và giấy phép: ./data/LICENSE-common-passwords.md
// Import JSON (không đọc file lúc chạy) để tsdown đóng gói được vào dist.
import entries from './data/common-passwords.json' with { type: 'json' };

let cached: ReadonlySet<string> | undefined;

/** Danh sách mật khẩu phổ biến (chữ thường, 12–256 ký tự) — nạp một lần, dùng chung. */
export function loadCommonPasswordList(): ReadonlySet<string> {
  cached ??= new Set<string>(entries);
  return cached;
}
