import type { MessageDto } from '@taskflow/contracts/chat';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { chatApi, chatKeys, upsertMessage, type MessagesData } from '@/entities/chat';

// Sửa / xóa tin của chính mình (ADR-144: sửa ≤ 15 phút; xóa ⇒ thân NULL + tệp tách) và tải tệp (ADR-141).

function usePatch(convId: string) {
  const queryClient = useQueryClient();
  return (message: MessageDto) => {
    queryClient.setQueryData<MessagesData>(chatKeys.messages(convId), (d) =>
      upsertMessage(d, message),
    );
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
  };
}

export function useEditMessage(convId: string) {
  const patch = usePatch(convId);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => chatApi.edit(id, body),
    onSuccess: patch,
  });
}

export function useDeleteMessage(convId: string) {
  const patch = usePatch(convId);
  return useMutation({
    mutationFn: (message: MessageDto) => chatApi.remove(message.id),
    // 204 không có tin ⇒ tự dựng trạng thái đã xóa (event `chat:message:updated` của server sẽ ghi đè giống hệt).
    onSuccess: (_, message) =>
      patch({ ...message, body: null, attachments: [], deletedAt: new Date().toISOString() }),
  });
}

/** Seam cho test (jsdom không điều hướng được). */
export const navigation = { assign: (url: string) => window.location.assign(url) };

/**
 * Tải tệp không phải ảnh (TL chốt, ADR-141): `POST download-url` (kiểm quyền LÚC BẤM) ⇒ `location.assign(url)` NGAY khi
 * nhận `{url}` (URL sống 60 s) — không `window.open` sau `await` (iOS chặn popup), không gom nhiều tệp, không dựa vào
 * `pagehide`. `/media` trả `attachment` nên trang hiện tại KHÔNG bị thay.
 */
export function useDownload() {
  return useMutation({
    mutationFn: (attachmentId: string) => chatApi.downloadUrl(attachmentId),
    onSuccess: ({ url }) => navigation.assign(url),
  });
}
