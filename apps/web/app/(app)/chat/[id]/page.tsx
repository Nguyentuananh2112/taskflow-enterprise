import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Trò chuyện' };

// Một cuộc trò chuyện — uuid trên URL (frontend.md §1.1); < md toàn màn hình, ≥ md cùng danh sách.
export { ChatPage as default } from '@/views/chat';
