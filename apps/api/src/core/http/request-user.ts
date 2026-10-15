import type { Request } from 'express';

import { UnauthorizedError } from '../errors';

/**
 * Người dùng đã xác thực của request (ADR-014: có kiểu, cấm `as any`). Middleware `authenticate`
 * của module auth gắn vào; module khác chỉ phụ thuộc hình dạng này trong core (không import auth).
 */
export interface RequestUser {
  id: string;
  /** familyId của phiên refresh. */
  sid: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- cách chuẩn mở rộng Request của Express
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}

/** Lấy user đã xác thực — route chỉ gọi sau `authenticate`; thiếu ⇒ 401 (lỗi wiring, không lộ 500). */
export function requireUser(req: Request): RequestUser {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

/** `X-Client-Id` hợp lệ (uuid) hoặc null — KHÔNG phải thông tin xác thực (security §5.2). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function clientIdOf(req: Request): string | null {
  const raw = req.headers['x-client-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

/** Metadata phiên cho refresh token (User-Agent cắt 255 ký tự, IP thật sau `trust proxy`). */
export function sessionMetaOf(req: Request): { userAgent: string | null; ip: string | null } {
  const ua = req.headers['user-agent'];
  return { userAgent: ua ? ua.slice(0, 255) : null, ip: req.ip ?? null };
}
