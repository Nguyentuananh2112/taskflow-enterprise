import type { Metadata } from 'next';

// ADR-137: trang công khai NGOÀI nhóm (auth)/(app) — không qua GuestGate / AuthGate. Không gửi Referer (token nằm ở
// fragment, nhưng trang không dẫn URL của mình đi đâu).
export const metadata: Metadata = { title: 'Kích hoạt tài khoản', referrer: 'no-referrer' };

export { ActivatePage as default } from '@/views/activate';
