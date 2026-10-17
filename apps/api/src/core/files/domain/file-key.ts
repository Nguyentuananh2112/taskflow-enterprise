/**
 * Khóa blob trong kho (ADR-141): DO SERVER SINH, không chứa tên người dùng, không content-addressed.
 * Kiểm bằng regex TRƯỚC mọi thao tác đĩa — đây là ranh giới chống path traversal.
 *
 * Hai dạng:
 * - ngẫu nhiên CÓ TIỀN TỐ MODULE (B M1 T-069, TL): `<namespace>/<26 ký tự base32>` — 128 bit, RFC 4648 chữ thường,
 *   không padding; trên đĩa `<namespace>/ab/cd/<26>`. Mỗi module một namespace ⇒ bước dọn của module chỉ quét
 *   namespace CỦA MÌNH, không bao giờ xóa nhầm blob của module khác. Module mới thêm vào `FILE_NAMESPACES`;
 * - avatar (ADR-142, `users.avatar_version` là cột duy nhất): `avatars/<userId>/<version>/<256|64>`.
 */

export type FileKey = string & { readonly __brand: 'FileKey' };

/** Namespace của khóa ngẫu nhiên — một module một phần tử (chat: đính kèm T-069). */
export const FILE_NAMESPACES = ['chat'] as const;
export type FileNamespace = (typeof FILE_NAMESPACES)[number];

/** Dựng TỪ `FILE_NAMESPACES` (B) — thêm module chỉ sửa một chỗ. Namespace là chữ thường a–z (không ký tự regex). */
const NAMESPACED_KEY = new RegExp(`^(${FILE_NAMESPACES.join('|')})/([a-z2-7]{26})$`);
const AVATAR_KEY =
  /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[1-9][0-9]{0,8}\/(256|64)$/;

export type AvatarVariant = '256' | '64';

export function isFileKey(value: string): value is FileKey {
  return NAMESPACED_KEY.test(value) || AVATAR_KEY.test(value);
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export const isFileNamespace = (value: string): value is FileNamespace =>
  (FILE_NAMESPACES as readonly string[]).includes(value);

/** Khóa ngẫu nhiên của `namespace` từ 16 byte ngẫu nhiên (adapter cấp — domain không tự sinh). */
export function randomFileKey(namespace: FileNamespace, bytes: Uint8Array): FileKey {
  return `${namespace}/${base32Token(bytes)}` as FileKey;
}

/** 16 byte ⇒ 26 ký tự base32 chữ thường (cũng là tên tệp tạm). */
export function base32Token(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new RangeError('cần đúng 16 byte');
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function avatarFileKey(userId: string, version: number, variant: AvatarVariant): FileKey {
  const key = `avatars/${userId.toLowerCase()}/${version}/${variant}`;
  if (!isFileKey(key)) throw new RangeError('khóa avatar không hợp lệ');
  return key;
}

/** Đường dẫn tương đối trong kho (dấu `/`): khóa ngẫu nhiên ⇒ `<ns>/ab/cd/<26>`; avatar giữ nguyên. */
export function relativePathOf(key: FileKey): string {
  const m = NAMESPACED_KEY.exec(key);
  if (!m) return key;
  const [, ns, token = ''] = m;
  return `${ns}/${token.slice(0, 2)}/${token.slice(2, 4)}/${token}`;
}
