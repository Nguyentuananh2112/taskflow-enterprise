import { createDailyOnce } from '@/shared/lib/daily-once';

/** Dialog nhắc chấm công (T-045): tối đa 1 lần / ngày cho mỗi người (Mốc 3.5 — chấm công thuộc công ty). */
const once = createDailyOnce('tf.checkin-prompt.v1');

export const promptMemory = {
  // Mốc 3.5: chấm công thuộc công ty ⇒ nhắc theo NGƯỜI (scope cũ `user:ws` khác hash, `forgetAll` vẫn dọn).
  seen: (userId: string, date: string) => once.seen(userId, date),
  mark: (userId: string, date: string) => once.mark(userId, date),
  /** Phiên kết thúc ⇒ xóa dấu "đã nhắc" của mọi user/workspace trên máy này (review B LOW-1). */
  forgetAll: () => once.forgetAll(),
  resetForTest: () => once.resetForTest(),
};
