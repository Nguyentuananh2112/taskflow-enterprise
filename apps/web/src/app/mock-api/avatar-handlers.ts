import { AvatarUploadResponseDto } from '@taskflow/contracts/auth';
import { AVATAR_MAX_BYTES, Uuid } from '@taskflow/contracts/common';
import { HttpResponse, http, type HttpHandler } from 'msw';

import type { MockAvatars } from './mock-avatars';
import type { MockDb } from './mock-db';
import { requireCompany } from './mock-guard';
import type { RateLimiter } from './request-guards';
import { fail, failUnlisted, noContent, ok } from './respond';

// Avatar của mock API (avatar-chat.md ADR-141/142, §4): `PUT/DELETE me/avatar`, `DELETE hr/employees/:userId/avatar`,
// `GET media/avatars/:userId/:variant`. Thứ tự lỗi như server: 401 → 403 → 400 → 404 → 413/415 → 429.

/** Chỉ ảnh mà avatar nhận (sniff theo nội dung, không tin đuôi / Content-Type — ADR-141). */
function sniffImage(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** `X-Upload-Name`: bắt buộc, percent-encoded UTF-8, ≤ 255 byte sau giải mã (F-03c). */
function uploadName(request: Request): string | null {
  const raw = request.headers.get('x-upload-name');
  if (!raw) return null;
  try {
    const name = decodeURIComponent(raw);
    return name.length > 0 && new TextEncoder().encode(name).length <= 255 ? name : null;
  } catch {
    return null;
  }
}

const mediaGone = () =>
  new HttpResponse(
    '<!doctype html><meta charset="utf-8"><title>Không tìm thấy</title><p>Liên kết đã hết hạn hoặc không còn tồn tại.</p><p><a href="/">Quay lại</a></p>',
    {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    },
  );

export function createAvatarHandlers(
  baseUrl: string,
  db: MockDb,
  avatars: MockAvatars,
  limit: RateLimiter,
): HttpHandler[] {
  const url = (path: string) => `${baseUrl}${path}`;

  return [
    http.put(url('/me/avatar'), async ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      if (!uploadName(request)) {
        return failUnlisted(400, 'INVALID_UPLOAD_NAME', 'Tên tệp không hợp lệ.');
      }
      if (Number(request.headers.get('content-length') ?? 0) > AVATAR_MAX_BYTES) {
        return fail(413, 'PAYLOAD_TOO_LARGE');
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > AVATAR_MAX_BYTES) return fail(413, 'PAYLOAD_TOO_LARGE');
      const type = sniffImage(bytes);
      if (!type) {
        return failUnlisted(415, 'UNSUPPORTED_FILE_TYPE', 'Chỉ nhận ảnh JPG, PNG hoặc WebP.');
      }
      const limited = limit(`avatar:${ctx.ok.user.id}`, 10); // 10 lần / giờ / user (ADR-142)
      if (limited) return limited;
      avatars.set(ctx.ok.user.id, bytes, type);
      const fields = avatars.fieldsOf(ctx.ok.user.id);
      return ok(AvatarUploadResponseDto, {
        avatarUrl: fields.avatarUrl ?? '',
        avatarUrlLarge: fields.avatarUrlLarge ?? '',
      });
    }),

    http.delete(url('/me/avatar'), ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      avatars.remove(ctx.ok.user.id);
      return noContent();
    }),

    // TL: hr:manage; avatar của Admin / người giữ grant chỉ Admin gỡ; không tự gỡ qua route này (SEC-CH-17).
    // Audit `AVATAR_REMOVED` ở server — mock không có sổ audit HR.
    http.delete(url('/hr/employees/:userId/avatar'), ({ request, params }) => {
      const ctx = requireCompany(request, db, 'hr:manage');
      if (ctx.response) return ctx.response;
      const userId = String(params.userId);
      if (!Uuid.safeParse(userId).success) return fail(400, 'VALIDATION_ERROR');
      const target = db.company.row(userId);
      if (!target) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'employee' });
      const privileged = target.role === 'ADMIN' || target.grants.length > 0;
      if (userId === ctx.ok.user.id || (privileged && ctx.ok.company.role !== 'ADMIN')) {
        return fail(403, 'FORBIDDEN_ACCESS');
      }
      avatars.remove(userId);
      return noContent();
    }),

    // Không Bearer: chỉ "chữ ký" + kiểm version / hạn mỗi lần; lỗi ⇒ trang HTML tối giản (ADR-141, E).
    http.get(url('/media/avatars/:userId/:variant'), ({ request, params }) => {
      const query = new URL(request.url).searchParams;
      const variant = String(params.variant);
      if ((variant !== '64' && variant !== '256') || query.get('sig') !== 'mock')
        return mediaGone();
      const stored = avatars.read(
        String(params.userId),
        Number(query.get('v')),
        Number(query.get('exp')),
      );
      if (!stored) return mediaGone();
      return new HttpResponse(stored.bytes.slice().buffer, {
        headers: {
          'Content-Type': stored.type,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cache-Control': 'private, max-age=3600',
        },
      });
    }),
  ];
}
