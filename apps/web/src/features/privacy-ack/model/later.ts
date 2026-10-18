import { createSessionOnce } from '@/shared/lib/session-once';

// "Để sau" của hộp thoại quyền riêng tư (T-075): nhớ theo (người, phiên bản) trong phiên — phiên sau hiện lại tới khi
// bấm "Tôi đã đọc".
const once = createSessionOnce();
const key = (userId: string, version: number) => `${userId}|${version}`;

export const privacyLater = {
  has: (userId: string, version: number) => once.seen(key(userId, version)),
  add: (userId: string, version: number) => once.mark(key(userId, version)),
  forgetAll: () => once.forgetAll(),
};
