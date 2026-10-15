import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Bảng công việc' };

// Board Kanban (+ `?task=<taskId>` mở drawer) — uuid trên URL, không slug (frontend.md §1.1).
export { BoardPage as default } from '@/views/board';
