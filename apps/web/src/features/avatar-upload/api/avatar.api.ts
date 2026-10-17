import { AvatarUploadResponseDto } from '@taskflow/contracts/auth';
import * as z from 'zod';

import { http, type UploadProgress } from '@/shared/api';

// `PUT/DELETE /me/avatar` (avatar-chat.md §4, ADR-142). Ảnh đã cắt ở trình duyệt ⇒ tên gửi kèm cố định.

const UPLOAD_NAME = 'anh-dai-dien.jpg';

export type UploadAvatarInput = Readonly<{
  blob: Blob;
  onProgress?: UploadProgress;
  signal?: AbortSignal;
}>;

export const avatarApi = {
  upload: ({ blob, onProgress, signal }: UploadAvatarInput) =>
    http.upload('PUT', '/me/avatar', {
      schema: AvatarUploadResponseDto,
      body: blob,
      name: UPLOAD_NAME,
      ...(onProgress ? { onProgress } : {}),
      ...(signal ? { signal } : {}),
    }),
  remove: () => http.delete('/me/avatar', { schema: z.undefined() }),
};
