import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Đăng ký' };

// File route chỉ render view (frontend.md §2.1).
export { RegisterPage as default } from '@/views/register';
