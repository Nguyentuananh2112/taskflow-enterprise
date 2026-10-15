import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import { requestContext } from '../context/request-context';
import { OriginNotAllowedError, UnsupportedMediaTypeError } from '../errors';
import { errorSerializer } from '../logging/error-serializer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUIET_PATHS = new Set(['/healthz', '/readyz']);

/** `X-Request-Id` của client nếu là uuid hợp lệ, không thì sinh mới (devops.md §6.1). */
export function resolveRequestId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && UUID.test(value) ? value.toLowerCase() : randomUUID();
}

type ErrSerializer = (err: unknown) => unknown;

/**
 * pino-http tạo logger con với serializer `err` CHUẨN (chép mọi thuộc tính enumerable — kể cả
 * `meta` của lỗi Prisma) nếu không truyền ⇒ dùng lại serializer allow-list của logger gốc
 * (`createLogger`); thiếu thì dùng bản an toàn nhất (không stack). T-031 mục 0.
 */
function inheritedErrSerializer(logger: Logger): ErrSerializer {
  const own = (logger as unknown as Record<symbol, Record<string, unknown> | undefined>)[
    pino.symbols.serializersSym
  ]?.['err'];
  return typeof own === 'function'
    ? (own as ErrSerializer)
    : errorSerializer({ includeStack: false });
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
      err: inheritedErrSerializer(logger),
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

/** Tách `type/subtype; charset=…` của header Content-Type (chữ thường, bỏ nháy). */
export function parseContentType(header: string | undefined): { type: string; charset?: string } {
  const [type = '', ...params] = (header ?? '').split(';').map((p) => p.trim().toLowerCase());
  const charset = params
    .map((p) => /^charset\s*=\s*"?([^";\s]+)"?$/.exec(p)?.[1])
    .find((c): c is string => c !== undefined);
  return charset === undefined ? { type } : { type, charset };
}

const UTF8 = new Set(['utf-8', 'utf8']);

/**
 * POST/PUT/PATCH bắt buộc `Content-Type: application/json` (kể cả khi không có body) để trình duyệt
 * luôn preflight — một lớp chống CSRF (security.md §6.3). JSON chỉ được là UTF-8 (RFC 8259): mọi
 * `charset` khác (utf-7, utf-16…) ⇒ 415, kể cả DELETE có body (QA F, T-021 finding A5). Sai ⇒ 415.
 */
export const requireJsonContentType: RequestHandler = (req, _res, next) => {
  const { type, charset } = parseContentType(req.headers['content-type']);
  const bodyRequired = METHODS_WITH_BODY.has(req.method);
  const wrongType = bodyRequired && type !== 'application/json';
  const wrongCharset = type === 'application/json' && charset !== undefined && !UTF8.has(charset);
  next(wrongType || wrongCharset ? new UnsupportedMediaTypeError() : undefined);
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
