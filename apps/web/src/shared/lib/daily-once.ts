import { readLocal, writeLocal } from './storage';

// "Tối đa 1 lần / ngày" cho một việc theo phạm vi (vd user + workspace) — T-045 nhắc chấm công. Lưu NGÀY cuối cùng
// theo khóa phạm vi ⇒ không phình theo thời gian. Storage lỗi (riêng tư / bị chặn) ⇒ bộ nhớ của tab vẫn giữ trong phiên.

let suppressed = false;

export function createDailyOnce(namespace: string) {
  const memory = new Set<string>();
  const storageKey = (scope: string) => `${namespace}:${scope}`;
  return {
    /** Đã làm trong `date` cho `scope` chưa. */
    seen(scope: string, date: string): boolean {
      if (suppressed) return true;
      return memory.has(`${scope}|${date}`) || readLocal(storageKey(scope)) === date;
    },
    mark(scope: string, date: string): void {
      memory.add(`${scope}|${date}`);
      writeLocal(storageKey(scope), date);
    },
    resetForTest(): void {
      memory.clear();
    },
  };
}

/**
 * Test: coi như "đã làm" ở MỌI phạm vi — bộ test không nói về việc đó (vd dialog modal nhắc chấm công che trang, có hiện
 * hay không lại phụ thuộc giờ máy chạy test) bật ở setup; test của chính việc đó tắt lại.
 */
export function suppressDailyOnceForTest(value: boolean): void {
  suppressed = value;
}
