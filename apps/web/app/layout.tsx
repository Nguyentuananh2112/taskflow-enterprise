import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@/app/styles/globals.css';

export const metadata: Metadata = {
  title: 'TaskFlow',
  description: 'Quản lý công việc theo nhóm với bảng Kanban thời gian thực.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
