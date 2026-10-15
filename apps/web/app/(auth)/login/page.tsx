import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Đăng nhập' };

// File route chỉ render view (frontend.md §2.1).
export { LoginPage as default } from '@/views/login';
