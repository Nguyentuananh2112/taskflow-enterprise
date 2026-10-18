import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Trò chuyện' };

// Phòng trò chuyện của workspace (ADR-143) — mở từ trang workspace, rồi chuyển sang /chat/[id].
export { WorkspaceRoomPage as default } from '@/views/chat';
