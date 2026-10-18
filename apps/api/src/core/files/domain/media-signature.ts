import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * URL ký của `/media` (ADR-141, B M3): HMAC-SHA256 trên TUPLE CHUẨN HÓA
 * `v1|<purpose>|<kind>|<id>|<variant>|<version>|<exp>` — đổi bất kỳ thành phần nào ⇒ chữ ký sai.
 * `purpose` không nằm trong URL: suy từ `variant` (`file` ⇒ `download`, còn lại ⇒ `view`).
 */

export type MediaKind = 'avatars' | 'chat';
export type MediaPurpose = 'view' | 'download';
export type MediaVariant = '256' | '64' | 'preview' | 'thumb' | 'file';

export const MEDIA_VARIANTS: Readonly<Record<MediaKind, readonly MediaVariant[]>> = {
  avatars: ['256', '64'],
  chat: ['preview', 'thumb', 'file'],
};

export interface MediaTuple {
  kind: MediaKind;
  id: string;
  variant: MediaVariant;
  /** `avatar_version`; tệp chat luôn 1. */
  version: number;
  /** Giây Unix — hết hạn khi `now >= exp`. */
  exp: number;
}

export const purposeOf = (variant: MediaVariant): MediaPurpose =>
  variant === 'file' ? 'download' : 'view';

export const isVariantOf = (kind: MediaKind, variant: string): variant is MediaVariant =>
  (MEDIA_VARIANTS[kind] as readonly string[]).includes(variant);

export function canonicalTuple(t: MediaTuple): string {
  return ['v1', purposeOf(t.variant), t.kind, t.id, t.variant, t.version, t.exp].join('|');
}

/** base64url không padding của HMAC-SHA256 = 43 ký tự. */
const SIG_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function signMedia(secret: string, t: MediaTuple): string {
  return createHmac('sha256', secret).update(canonicalTuple(t)).digest('base64url');
}

export interface MediaSecrets {
  current: string;
  /** Chỉ để KIỂM trong lúc xoay khóa — không bao giờ dùng để ký. */
  previous?: string;
}

/**
 * Chữ ký đúng (khóa hiện tại hoặc khóa cũ) và chưa hết hạn. So sánh constant-time trên hai buffer
 * cùng độ dài; định dạng `sig` sai ⇒ `false` ngay (không tính HMAC).
 */
export function verifyMedia(
  secrets: MediaSecrets,
  t: MediaTuple,
  sig: string,
  nowSec: number,
): boolean {
  if (!SIG_FORMAT.test(sig) || nowSec >= t.exp) return false;
  const given = Buffer.from(sig, 'base64url');
  const matches = (secret: string) =>
    timingSafeEqual(given, Buffer.from(signMedia(secret, t), 'base64url'));
  const okCurrent = matches(secrets.current);
  const okPrevious = secrets.previous !== undefined && matches(secrets.previous);
  return okCurrent || okPrevious;
}

/**
 * `exp` theo KHUNG (ADR-141, E1): mọi URL ký trong cùng khung có cùng `exp` ⇒ trình duyệt cache được;
 * URL sống từ `bucket` tới `2 × bucket` giây.
 */
export function bucketExpiry(nowSec: number, bucketSec: number): number {
  return (Math.floor(nowSec / bucketSec) + 2) * bucketSec;
}
