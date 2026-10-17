import { UserDto, UserRefDto } from '@taskflow/contracts/auth';
import { Uuid } from '@taskflow/contracts/common';
import * as z from 'zod';

// TẠM (T-071, thống nhất với G — avatar-chat.md ADR-142): G commit vào `@taskflow/contracts/auth` (DTO) và
// `/realtime` (event) ở T-068 ⇒ xóa file này, đổi import, giữ nguyên tên.

/** URL ký tuyệt đối tới `/media/avatars/…` (có hạn — ADR-141). Không có / `null` ⇒ chữ cái. */
const AvatarUrl = z.string().min(1).nullable().optional();

/** `avatarUrl` = biến thể 64 px — mọi chỗ nhỏ (header, board, danh sách, chat). */
export const UserRefWithAvatarDto = UserRefDto.extend({ avatarUrl: AvatarUrl });
export type UserRefWithAvatarDto = z.infer<typeof UserRefWithAvatarDto>;

/** Người dùng hiện tại (`/auth/me`, login, `PATCH /me`): thêm `avatarUrlLarge` = 256 px cho `/account`. */
export const UserWithAvatarDto = UserDto.extend({
  avatarUrl: AvatarUrl,
  avatarUrlLarge: AvatarUrl,
});
export type UserWithAvatarDto = z.infer<typeof UserWithAvatarDto>;

/** `PUT /me/avatar` ⇒ 200. */
export const AvatarUploadResponseDto = z.object({
  avatarUrl: z.string().min(1),
  avatarUrlLarge: z.string().min(1),
});
export type AvatarUploadResponseDto = z.infer<typeof AvatarUploadResponseDto>;

/** Event `user:avatar-changed` (payload trong RealtimeEnvelope) — phát tới mọi socket của công ty. */
export const USER_AVATAR_CHANGED = 'user:avatar-changed';
export const UserAvatarChangedEventDto = z.object({
  userId: Uuid,
  avatarUrl: z.string().min(1).nullable(),
});
export type UserAvatarChangedEventDto = z.infer<typeof UserAvatarChangedEventDto>;

/**
 * Mã lỗi MỚI của upload (G thêm vào `ErrorCode`); web nhận như `serverCode` cho tới khi contracts có.
 * `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `RATE_LIMITED` đã có sẵn.
 */
export const UPLOAD_ERROR_CODES = [
  'INVALID_UPLOAD_NAME',
  'UNSUPPORTED_FILE_TYPE',
  'MACRO_OR_ACTIVE_CONTENT',
  'IMAGE_PROCESSING_BUSY',
  'IMAGE_PROCESSING_UNAVAILABLE',
  'STORAGE_FULL',
] as const;

/** Trần phía client (server cũng chặn — ADR-141). */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
