import { readLocal, removeLocalByPrefix, writeLocal } from './storage';

// "Tối đa 1 lần / ngày" cho một việc theo phạm vi (vd user + workspace) — T-045 nhắc chấm công. Lưu NGÀY cuối cùng
// theo khóa phạm vi ⇒ không phình theo thời gian. Storage lỗi (riêng tư / bị chặn) ⇒ bộ nhớ của tab vẫn giữ trong phiên.

let suppressed = false;

/**
 * Băm ngắn (FNV-1a 32 bit, hex) phạm vi trước khi làm khóa localStorage (review B, LOW-1): máy dùng chung không lộ UUID
 * user / workspace thô qua devtools. Không phải bảo mật mật mã — chỉ để không lưu định danh đọc được.
 */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function createDailyOnce(namespace: string) {
  const memory = new Set<string>();
  const storageKey = (scope: string) => `${namespace}:${shortHash(scope)}`;
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
    /** Quên hết (mọi phạm vi) — gọi khi phiên kết thúc: máy dùng chung không giữ dấu vết của user trước. */
    forgetAll(): void {
      memory.clear();
      removeLocalByPrefix(`${namespace}:`);
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
