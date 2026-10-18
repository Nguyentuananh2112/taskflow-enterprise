import { useMutation, useQueryClient } from '@tanstack/react-query';

import { applyMyAvatar } from '@/entities/session';

import { avatarApi, type UploadAvatarInput } from '../api/avatar.api';

/** `PUT /me/avatar` ⇒ header + /account đổi ngay, chỗ khác làm mới (ADR-142). */
export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UploadAvatarInput) => avatarApi.upload(input),
    onSuccess: (fields) => applyMyAvatar(queryClient, fields),
  });
}

/** `DELETE /me/avatar` ⇒ về chữ cái. */
export function useRemoveAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => avatarApi.remove(),
    onSuccess: () => applyMyAvatar(queryClient, { avatarUrl: null, avatarUrlLarge: null }),
  });
}
