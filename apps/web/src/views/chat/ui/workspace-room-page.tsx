'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { chatApi, chatKeys } from '@/entities/chat';
import { EmptyState } from '@/shared/ui/empty-state';

/**
 * `/chat/ws/[wsId]` — lối vào phòng trò chuyện của workspace từ trang ws (ADR-143: tạo lười, `PUT …/conversation`) rồi
 * thay URL bằng `/chat/[id]`. Không còn là thành viên / ws đã xóa ⇒ 404 ⇒ báo.
 */
export function WorkspaceRoomPage() {
  const { wsId = '' } = useParams<{ wsId: string }>();
  const router = useRouter();
  const room = useQuery({
    queryKey: [...chatKeys.all, 'ws-room', wsId],
    queryFn: () => chatApi.workspaceRoom(wsId),
    enabled: wsId !== '',
    retry: false,
  });
  const id = room.data?.id;
  useEffect(() => {
    if (id) router.replace(`/chat/${id}`);
  }, [id, router]);

  if (room.isError) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Không mở được phòng trò chuyện của workspace"
          action={
            <Link href="/chat" className="text-sm underline">
              Về trò chuyện
            </Link>
          }
        />
      </main>
    );
  }
  return (
    <p role="status" className="p-6 text-sm text-text-muted">
      Đang mở phòng trò chuyện…
    </p>
  );
}
