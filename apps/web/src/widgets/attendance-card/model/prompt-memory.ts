import { createDailyOnce } from '@/shared/lib/daily-once';

/** Dialog nhắc chấm công (T-045): tối đa 1 lần / ngày cho mỗi (user, workspace). */
const once = createDailyOnce('tf.checkin-prompt.v1');

export const promptMemory = {
  seen: (userId: string, wsId: string, date: string) => once.seen(`${userId}:${wsId}`, date),
  mark: (userId: string, wsId: string, date: string) => once.mark(`${userId}:${wsId}`, date),
  /** Phiên kết thúc ⇒ xóa dấu "đã nhắc" của mọi user/workspace trên máy này (review B LOW-1). */
  forgetAll: () => once.forgetAll(),
  resetForTest: () => once.resetForTest(),
};
