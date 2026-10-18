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

/** Bỏ query string / fragment khỏi URL request. */
export const pathOf = (url: string | undefined): string => (url ?? '').split(/[?#]/)[0] ?? '';

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
    autoLogging: { ignore: (req) => QUIET_PATHS.has(pathOf(req.url)) },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    // M3 (T-031): userId khi đã xác thực. pino-http gọi customProps cả lúc response xong ⇒ userId do
    // `authenticate` gắn có mặt. `reqId` + `ip` đến từ mixin của logger (ngữ cảnh request).
    customProps: (req) => {
      const user = (req as IncomingMessage & { user?: { id: string } }).user;
      return user ? { userId: user.id } : {};
    },
    serializers: {
      // L5: chỉ path, KHÔNG query string (vd `?q=<email>` của tìm thành viên).
      req: (req: { id: unknown; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        path: pathOf(req.url),
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      err: inheritedErrSerializer(logger),
    },
  });
  const bindContext: RequestHandler = (req, _res, next) => {
    requestContext.run({ requestId: req.id as string, ip: req.ip }, next);
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
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], // PUT: members/:userId/grants (T-037)
      // Idempotency-Key: check-in / check-out (T-038, attendance-leave.md §5)
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Request-Id',
        'X-Client-Id',
        'Idempotency-Key',
        // Mốc 6 (ADR-141): tên gốc của upload nhị phân — thiếu ⇒ preflight của trình duyệt chặn upload thật.
        'X-Upload-Name',
      ],
      // Content-Disposition (T-055, A): web đọc tên file .xlsx của báo cáo khi tải qua fetch.
      exposedHeaders: [
        'X-Request-Id',
        'Retry-After',
        'RateLimit-Policy',
        'RateLimit',
        'Content-Disposition',
      ],
      maxAge: 600,
    }),
  ];
}

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Tách `type/subtype; charset=…` của header Content-Type (chữ thường, bỏ nháy). `ambiguous`: có hơn
 * một tham số charset, hoặc tham số charset không đọc được — ta và body-parser có thể hiểu khác nhau
 * (body-parser lấy cái CUỐI) ⇒ phải từ chối (audit T-028 F4).
 */
export function parseContentType(header: string | undefined): {
  type: string;
  charset?: string;
  ambiguous?: true;
} {
  const [type = '', ...params] = (header ?? '').split(';').map((p) => p.trim().toLowerCase());
  const charsetParams = params.filter((p) => /^charset\s*=/.test(p));
  const charsets = charsetParams
    .map((p) => /^charset\s*=\s*"?([^";\s]+)"?$/.exec(p)?.[1])
    .filter((c): c is string => c !== undefined);
  const ambiguous = charsetParams.length > 1 || charsets.length !== charsetParams.length;
  const charset = charsets[0];
  return {
    type,
    ...(charset === undefined ? {} : { charset }),
    ...(ambiguous ? { ambiguous: true as const } : {}),
  };
}

const UTF8 = new Set(['utf-8', 'utf8']);

/**
 * Ngoại lệ content-type ĐÚNG cặp method + path (ADR-141, B M1): chỉ các route upload nhị phân nhận
 * `application/octet-stream`; route khác — hoặc đúng path sai method — gửi octet-stream ⇒ 415 như cũ. Lớp
 * chống CSRF chính của các route này là Bearer (không cookie). Path so sau khi bỏ `/` cuối, chữ thường
 * (Express mặc định không phân biệt hoa thường / `/` cuối khi định tuyến).
 */
export const RAW_UPLOAD_ROUTES: readonly { method: string; path: string }[] = [
  { method: 'PUT', path: '/api/v1/me/avatar' },
  { method: 'POST', path: '/api/v1/chat/uploads' },
];
export const RAW_UPLOAD_CONTENT_TYPE = 'application/octet-stream';

export function isRawUploadRoute(method: string, path: string): boolean {
  const normalized = path.toLowerCase().replace(/\/+$/, '');
  return RAW_UPLOAD_ROUTES.some((r) => r.method === method && r.path === normalized);
}

/**
 * POST/PUT/PATCH bắt buộc `Content-Type: application/json` (kể cả khi không có body) để trình duyệt
 * luôn preflight — một lớp chống CSRF (security.md §6.3). JSON chỉ được là UTF-8 (RFC 8259): mọi
 * `charset` khác (utf-7, utf-16…) ⇒ 415, kể cả DELETE có body (QA F, T-021 finding A5). Sai ⇒ 415.
 */
export const requireJsonContentType: RequestHandler = (req, _res, next) => {
  const { type, charset, ambiguous } = parseContentType(req.headers['content-type']);
  if (type === RAW_UPLOAD_CONTENT_TYPE && isRawUploadRoute(req.method, req.path)) {
    next();
    return;
  }
  const bodyRequired = METHODS_WITH_BODY.has(req.method);
  const wrongType = bodyRequired && type !== 'application/json';
  const wrongCharset =
    type === 'application/json' && (ambiguous || (charset !== undefined && !UTF8.has(charset)));
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
