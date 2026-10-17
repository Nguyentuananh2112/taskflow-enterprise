'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { session } from '@/entities/session';
import { toast } from '@/shared/ui/toast';
import { promptMemory } from '@/widgets/attendance-card';

/**
 * Dọn dẹp khi phiên kết thúc (frontend.md §3.3, T-019 việc 4): xóa toàn bộ cache dữ liệu của người
 * dùng cũ; hết hạn/bị thu hồi ⇒ báo cho người dùng. Điều hướng về /login do AuthGate lo.
 */
export function SessionEffects() {
  const queryClient = useQueryClient();
  useEffect(() => {
    session.start();
    return session.onEnded((reason) => {
      queryClient.clear();
      // Máy dùng chung: không để lại dấu vết user/workspace của dialog nhắc chấm công (T-045, review B LOW-1).
      promptMemory.forgetAll();
      if (reason !== 'logout') {
        toast({
          title: 'Phiên đăng nhập đã hết',
          description: 'Vui lòng đăng nhập lại.',
          tone: 'error',
        });
      }
    });
  }, [queryClient]);
  return null;
}
