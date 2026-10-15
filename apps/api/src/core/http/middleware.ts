import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import { requestContext } from '../context/request-context';
import { OriginNotAllowedError, UnsupportedMediaTypeError } from '../errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUIET_PATHS = new Set(['/healthz', '/readyz']);

/** `X-Request-Id` của client nếu là uuid hợp lệ, không thì sinh mới (devops.md §6.1). */
export function resolveRequestId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && UUID.test(value) ? value.toLowerCase() : randomUUID();
}

/**
 * Đầu chuỗi middleware: gán requestId, trả lại trong header `X-Request-Id`, log JSON mỗi
 * request (pino-http, đã redact) và mở ngữ cảnh AsyncLocalStorage cho phần còn lại.
 */
export function requestLogging(logger: Logger): RequestHandler[] {
  const httpLogger = pinoHttp<IncomingMessage, ServerResponse>({
    logger,
    genReqId: (req, res) => {
      const id = resolveRequestId(req.headers['x-request-id']);
      res.setHeader('X-Request-Id', id);
      return id;
    },
    autoLogging: { ignore: (req) => QUIET_PATHS.has((req.url ?? '').split('?')[0] ?? '') },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
  const bindContext: RequestHandler = (req, _res, next) => {
    requestContext.run({ requestId: req.id as string }, next);
  };
  return [httpLogger, bindContext];
}

export interface SecurityOptions {
  corsOrigins: readonly string[];
  /** HSTS chỉ ở production (security.md §6.2). */
  hsts: boolean;
}

/** Helmet + CORS whitelist chính xác (security.md §6.2–6.3). */
export function securityHeaders(options: SecurityOptions): RequestHandler[] {
  const allowed = new Set(options.corsOrigins);
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      strictTransportSecurity: options.hsts
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
        : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
    cors({
      // So khớp chính xác — không regex, không phản chiếu Origin lạ.
      origin: (origin, callback) => callback(null, origin !== undefined && allowed.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Client-Id'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit-Policy', 'RateLimit'],
      maxAge: 600,
    }),
  ];
}

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

/**
 * POST/PUT/PATCH bắt buộc `Content-Type: application/json` (kể cả khi không có body) để
 * trình duyệt luôn preflight — một lớp chống CSRF (security.md §6.3). Sai ⇒ 415.
 */
export const requireJsonContentType: RequestHandler = (req, _res, next) => {
  if (!METHODS_WITH_BODY.has(req.method)) {
    next();
    return;
  }
  const mediaType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  next(mediaType === 'application/json' ? undefined : new UnsupportedMediaTypeError());
};

/** `express.json` với giới hạn body (ADR-028). Không bật `urlencoded`. */
export function jsonBody(limit: string): RequestHandler {
  return express.json({ limit, strict: true, type: 'application/json' });
}

/**
 * Endpoint dùng cookie (`/auth/refresh`, `/auth/logout`): `Origin` phải thuộc whitelist,
 * thiếu Origin cũng từ chối ⇒ 403 `ORIGIN_NOT_ALLOWED` (security.md §6.3). Gắn theo route.
 */
export function requireAllowedOrigin(corsOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(corsOrigins);
  return (req, _res, next) => {
    const origin = req.headers.origin;
    next(origin !== undefined && allowed.has(origin) ? undefined : new OriginNotAllowedError());
  };
}
