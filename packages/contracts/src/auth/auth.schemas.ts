import * as z from 'zod';

import { MeCompanyDto } from '../company/company-roles';

import { WorkspaceRole } from '../rbac/permissions';
import { IsoDateTime, Uuid, singleLineText } from '../common/primitives';

/**
 * Email: trim → NFC → lowercase trước khi validate (security.md §1.1, D11) — cùng thứ tự với
 * value object `Email` ở domain auth để hai bên luôn ra cùng một chuỗi.
 */
export const Email = z.string().trim().normalize('NFC').toLowerCase().max(254).pipe(z.email());
export type Email = z.infer<typeof Email>;

/** Đếm code point sau NFC (ADR-049, ADR-065) — `.min/.max` của Zod đếm UTF-16 code unit nên không dùng. */
function codePointLength(min: number, max: number) {
  return z
    .string()
    .transform((s) => s.normalize('NFC'))
    .refine(
      (s) => {
        const n = [...s].length;
        return n >= min && n <= max;
      },
      { error: `Phải dài từ ${min} đến ${max} ký tự` },
    );
}

/** Mật khẩu mới: 12–256 code point. Chặn mật khẩu phổ biến / trùng email nằm ở application. */
export const Password = codePointLength(12, 256);
export type Password = z.infer<typeof Password>;

/** Mật khẩu khi đăng nhập/xác nhận: không áp chính sách, chỉ chặn rỗng và quá dài (chống DoS). */
const PasswordInput = codePointLength(1, 256);

export const FullName = singleLineText(1, 100);
export type FullName = z.infer<typeof FullName>;

export const LoginBody = z.strictObject({ email: Email, password: PasswordInput });
export type LoginBody = z.infer<typeof LoginBody>;

export const ChangePasswordBody = z.strictObject({
  currentPassword: PasswordInput,
  newPassword: Password,
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>;

export const UpdateMeBody = z.strictObject({ fullName: FullName });
export type UpdateMeBody = z.infer<typeof UpdateMeBody>;

/**
 * URL ký tuyệt đối tới `/api/v1/media/avatars/:userId/:variant?v&exp&sig` (Mốc 6, ADR-141/142). Chữ ký phủ
 * cả variant ⇒ web KHÔNG tự đổi `64` ⇄ `256`. `null` / thiếu ⇒ hiện chữ cái. URL hết khung ⇒ `onError` ⇒ chữ cái.
 */
export const AvatarUrl = z.url({ protocol: /^https?$/ }).nullable();
export type AvatarUrl = z.infer<typeof AvatarUrl>;

export const UserDto = z.object({
  id: Uuid,
  email: z.string(),
  fullName: z.string(),
  createdAt: IsoDateTime,
  /** Mốc 6: variant 64 (chỗ nhỏ). Tùy chọn — server cũ / người đã nghỉ ⇒ thiếu hoặc null. */
  avatarUrl: AvatarUrl.optional(),
  /** Mốc 6: variant 256 (`/account`) — chỉ trong UserDto (người đang đăng nhập), không ở UserRefDto. */
  avatarUrlLarge: AvatarUrl.optional(),
});
export type UserDto = z.infer<typeof UserDto>;

/** Tham chiếu nhẹ trong task/audit/thành viên/thông báo/chat. `avatarUrl` = variant 64 (Mốc 6). */
export const UserRefDto = z.object({
  id: Uuid,
  fullName: z.string(),
  avatarUrl: AvatarUrl.optional(),
});
export type UserRefDto = z.infer<typeof UserRefDto>;

/** `PUT /me/avatar` (octet-stream ≤ `AVATAR_MAX_BYTES`, header `X-Upload-Name`) ⇒ 200. */
export const AvatarUploadResponseDto = z.object({
  avatarUrl: z.url({ protocol: /^https?$/ }),
  avatarUrlLarge: z.url({ protocol: /^https?$/ }),
});
export type AvatarUploadResponseDto = z.infer<typeof AvatarUploadResponseDto>;

export const AuthTokenDto = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.int().min(1),
});
export type AuthTokenDto = z.infer<typeof AuthTokenDto>;

export const MembershipDto = z.object({
  workspaceId: Uuid,
  workspaceName: z.string(),
  slug: z.string(),
  role: WorkspaceRole,
});
export type MembershipDto = z.infer<typeof MembershipDto>;

export const LoginResponse = AuthTokenDto.extend({ user: UserDto });
export type LoginResponse = z.infer<typeof LoginResponse>;

/** Mốc 3.5 (ADR-135): `company` — người không còn thuộc công ty ⇒ 401 SESSION_REVOKED, không có response này. */
export const MeResponse = z.object({
  user: UserDto,
  memberships: z.array(MembershipDto),
  company: MeCompanyDto,
});
export type MeResponse = z.infer<typeof MeResponse>;
