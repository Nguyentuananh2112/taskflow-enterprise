// "Đã làm trong phiên này" (T-075 — "Để sau" của thông báo quyền riêng tư): chỉ nhớ TRONG BỘ NHỚ của tab — phiên mới
// (đăng nhập lại, mở lại app) quên. Không lưu storage ⇒ máy dùng chung không để dấu vết.

let suppressed = false;

export function createSessionOnce() {
  const done = new Set<string>();
  return {
    seen: (key: string) => suppressed || done.has(key),
    mark: (key: string) => void done.add(key),
    /** Phiên kết thúc ⇒ quên. */
    forgetAll: () => done.clear(),
  };
}

/** Test: coi như "đã làm" — hộp thoại modal không che các bộ test không nói về nó; test của chính việc đó tắt lại. */
export function suppressSessionOnceForTest(value: boolean): void {
  suppressed = value;
}
