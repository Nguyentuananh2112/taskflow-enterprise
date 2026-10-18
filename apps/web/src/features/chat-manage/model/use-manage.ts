import type { ConversationDetailDto } from '@taskflow/contracts/chat';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { chatApi, chatKeys } from '@/entities/chat';

// Thao tác trên một hội thoại (avatar-chat.md §4, ADR-143/145): tắt tiếng (bỏ khỏi tổng header), quản trị nhóm.

export function useManage(convId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: chatKeys.detail(convId) });
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    void queryClient.invalidateQueries({ queryKey: chatKeys.unread });
  };
  const setDetail = (detail: ConversationDetailDto) => {
    queryClient.setQueryData(chatKeys.detail(convId), detail);
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
  };
  return {
    mute: useMutation({
      mutationFn: (muted: boolean) => chatApi.mute(convId, muted),
      onSuccess: refresh,
    }),
    rename: useMutation({
      mutationFn: (title: string) => chatApi.rename(convId, title),
      onSuccess: setDetail,
    }),
    add: useMutation({
      mutationFn: (ids: string[]) => chatApi.addMembers(convId, ids),
      onSuccess: setDetail,
    }),
    remove: useMutation({
      mutationFn: (id: string) => chatApi.removeMember(convId, id),
      onSuccess: refresh,
    }),
    owner: useMutation({
      mutationFn: (id: string) => chatApi.transferOwner(convId, id),
      onSuccess: setDetail,
    }),
    leave: useMutation({
      mutationFn: () => chatApi.leave(convId),
      onSuccess: () => {
        queryClient.removeQueries({ queryKey: chatKeys.messages(convId) });
        queryClient.removeQueries({ queryKey: chatKeys.detail(convId) });
        void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
        void queryClient.invalidateQueries({ queryKey: chatKeys.unread });
      },
    }),
  };
}
