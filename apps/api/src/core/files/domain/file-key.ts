/**
 * Khóa blob trong kho (ADR-141): DO SERVER SINH, không chứa tên người dùng, không content-addressed.
 * Kiểm bằng regex TRƯỚC mọi thao tác đĩa — đây là ranh giới chống path traversal.
 *
 * Hai dạng:
 * - ngẫu nhiên: 128 bit base32 (RFC 4648, chữ thường, không padding) = 26 ký tự ⇒ `ab/cd/<key>`;
 * - avatar (ADR-142, `users.avatar_version` là cột duy nhất): `avatars/<userId>/<version>/<256|64>`.
 */

export type FileKey = string & { readonly __brand: 'FileKey' };

const RANDOM_KEY = /^[a-z2-7]{26}$/;
const AVATAR_KEY =
  /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[1-9][0-9]{0,8}\/(256|64)$/;

export type AvatarVariant = '256' | '64';

export function isFileKey(value: string): value is FileKey {
  return RANDOM_KEY.test(value) || AVATAR_KEY.test(value);
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** 16 byte ngẫu nhiên (adapter cấp — domain không tự sinh) ⇒ khóa 26 ký tự. */
export function randomFileKey(bytes: Uint8Array): FileKey {
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
  return out as FileKey;
}

export function avatarFileKey(userId: string, version: number, variant: AvatarVariant): FileKey {
  const key = `avatars/${userId.toLowerCase()}/${version}/${variant}`;
  if (!isFileKey(key)) throw new RangeError('khóa avatar không hợp lệ');
  return key;
}

/** Đường dẫn tương đối trong kho (dấu `/`): khóa ngẫu nhiên ⇒ `ab/cd/<key>`; avatar giữ nguyên. */
export function relativePathOf(key: FileKey): string {
  return RANDOM_KEY.test(key) ? `${key.slice(0, 2)}/${key.slice(2, 4)}/${key}` : key;
}
