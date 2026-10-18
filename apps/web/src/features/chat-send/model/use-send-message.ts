import type { AttachmentDto, MessageDto, UploadResponseDto } from '@taskflow/contracts/chat';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import {
  chatApi,
  chatKeys,
  dropMessage,
  upsertMessage,
  type MessagesData,
  type SendInput,
} from '@/entities/chat';
import { useSession } from '@/entities/session';

// Gửi lạc quan (avatar-chat.md §7 E6): tin tạm `id = clientMsgId` hiện ngay; echo realtime / response thay đúng chỗ
// (khớp clientMsgId). Lỗi ⇒ giữ tin tạm, đánh dấu "Chưa gửi được" — "Thử lại" gửi CÙNG clientMsgId (server idempotent,
// không nhân đôi), "Bỏ" xóa tin tạm.

const failed = new Map<string, { convId: string; input: SendInput }>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version += 1;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Tin tạm chưa có id server. */
export const isPending = (m: MessageDto) => m.id === m.clientMsgId;

/** Ảnh / tệp vừa tải lên ⇒ đính kèm tạm (ảnh chưa có URL — giữ chỗ theo width/height). */
export const draftAttachment = (u: UploadResponseDto, mime = ''): AttachmentDto => ({
  id: u.uploadId,
  kind: u.kind,
  name: u.name,
  mime,
  sizeBytes: u.sizeBytes,
  width: u.width,
  height: u.height,
  previewUrl: null,
  thumbUrl: null,
});

export function useSendMessage(convId: string) {
  const queryClient = useQueryClient();
  const user = useSession().user;
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );

  const patch = useCallback(
    (fn: (d: MessagesData | undefined) => MessagesData | undefined) =>
      queryClient.setQueryData<MessagesData>(chatKeys.messages(convId), fn),
    [queryClient, convId],
  );

  const deliver = useCallback(
    async (input: SendInput) => {
      try {
        const message = await chatApi.send(convId, input);
        failed.delete(input.clientMsgId);
        notify();
        patch((d) => upsertMessage(d, message));
        void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      } catch (error) {
        failed.set(input.clientMsgId, { convId, input });
        notify();
        throw error;
      }
    },
    [convId, patch, queryClient],
  );

  /** Hiện tin tạm ngay rồi gửi. Ném lại lỗi để composer biết (vd 422) — tin tạm vẫn ở luồng với "Thử lại". */
  const send = useCallback(
    (
      input: Omit<SendInput, 'clientMsgId'>,
      attachments: AttachmentDto[] = [],
      replyTo: MessageDto | null = null,
    ) => {
      const clientMsgId = crypto.randomUUID();
      const full: SendInput = { ...input, clientMsgId };
      if (user) {
        patch((d) =>
          upsertMessage(d, {
            id: clientMsgId,
            conversationId: convId,
            sender: { id: user.id, fullName: user.fullName, avatarUrl: user.avatarUrl ?? null },
            clientMsgId,
            body: input.body?.trim() ? input.body.normalize('NFC').trim() : null,
            replyTo: replyTo && {
              id: replyTo.id,
              sender: replyTo.sender,
              bodyPreview: replyTo.body && [...replyTo.body].slice(0, 120).join(''),
              deleted: replyTo.deletedAt !== null,
            },
            attachments,
            createdAt: new Date().toISOString(),
            editedAt: null,
            deletedAt: null,
          }),
        );
      }
      return deliver(full);
    },
    [convId, deliver, patch, user],
  );

  const retry = useCallback(
    (clientMsgId: string) => {
      const entry = failed.get(clientMsgId);
      return entry ? deliver(entry.input) : Promise.resolve();
    },
    [deliver],
  );

  const discard = useCallback(
    (clientMsgId: string) => {
      failed.delete(clientMsgId);
      notify();
      patch((d) => dropMessage(d, clientMsgId));
    },
    [patch],
  );

  return { send, retry, discard, isFailed: (clientMsgId: string) => failed.has(clientMsgId) };
}
