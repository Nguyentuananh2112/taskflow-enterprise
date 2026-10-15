import * as z from 'zod';

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

export const RegisterBody = z.strictObject({
  email: Email,
  password: Password,
  fullName: FullName,
});
export type RegisterBody = z.infer<typeof RegisterBody>;

export const LoginBody = z.strictObject({ email: Email, password: PasswordInput });
export type LoginBody = z.infer<typeof LoginBody>;

export const ChangePasswordBody = z.strictObject({
  currentPassword: PasswordInput,
  newPassword: Password,
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>;

export const UpdateMeBody = z.strictObject({ fullName: FullName });
export type UpdateMeBody = z.infer<typeof UpdateMeBody>;

export const UserDto = z.object({
  id: Uuid,
  email: z.string(),
  fullName: z.string(),
  createdAt: IsoDateTime,
});
export type UserDto = z.infer<typeof UserDto>;

/** Tham chiếu nhẹ trong task/audit. */
export const UserRefDto = z.object({ id: Uuid, fullName: z.string() });
export type UserRefDto = z.infer<typeof UserRefDto>;

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

export const RegisterResponse = AuthTokenDto.extend({ user: UserDto, defaultWorkspaceId: Uuid });
export type RegisterResponse = z.infer<typeof RegisterResponse>;

export const LoginResponse = AuthTokenDto.extend({ user: UserDto });
export type LoginResponse = z.infer<typeof LoginResponse>;

export const MeResponse = z.object({ user: UserDto, memberships: z.array(MembershipDto) });
export type MeResponse = z.infer<typeof MeResponse>;
