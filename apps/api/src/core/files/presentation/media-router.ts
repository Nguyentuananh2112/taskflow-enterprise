import { pipeline } from 'node:stream/promises';

import express, {
  type ErrorRequestHandler,
  type RequestHandler,
  type Response,
  type Router,
} from 'express';
import * as z from 'zod';

import type { IClock } from '../../domain';
import { RateLimitedError } from '../../errors';
import type { ILogger } from '../../logging/logger';
import { attachmentDisposition } from '../domain/file-name';
import {
  isVariantOf,
  verifyMedia,
  type MediaKind,
  type MediaSecrets,
  type MediaVariant,
} from '../domain/media-signature';
import { FileMissingError, type IFileStore, type IMediaResolver } from '../ports';

export interface MediaRouterDeps {
  store: IFileStore;
  resolver: IMediaResolver;
  secrets: MediaSecrets;
  clock: IClock;
  logger: ILogger;
  /** ADR-141 (B M2, F-06): web + API chung eTLD+1 ⇒ `same-site`; không ⇒ `cross-origin` có chủ ý. */
  corp: 'same-site' | 'cross-origin';
  /** Hạn mức IP (`RATE_LIMIT_RULES.media`, 600/phút) — lỗi 429 cũng trả trang HTML. */
  rateLimit?: RequestHandler;
  /** Link "Quay lại" của trang lỗi — origin web (CORS_ORIGINS[0]). */
  backUrl: string;
}

const UUID = z.uuid();
const Query = z.strictObject({
  v: z.string().regex(/^[1-9][0-9]{0,8}$/),
  exp: z.string().regex(/^[1-9][0-9]{0,10}$/),
  sig: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

/**
 * Trang lỗi DUY NHẤT cho mọi nguyên nhân (không lộ lý do — SEC-CH-11); người dùng đang điều hướng (E). Không
 * script (CSP `sandbox`); "Quay lại" là link thường về web.
 */
export function mediaErrorHtml(backUrl: string): string {
  const href = backUrl.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  return (
    '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" ' +
    'content="width=device-width,initial-scale=1"><title>Không mở được tệp</title></head><body>' +
    `<p>Liên kết đã hết hạn hoặc không còn tồn tại.</p><p><a href="${href}">Quay lại</a></p>` +
    '</body></html>'
  );
}

function baseHeaders(res: Response, corp: MediaRouterDeps['corp']): void {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': corp,
  });
}

function sendError(
  res: Response,
  status: number,
  deps: Pick<MediaRouterDeps, 'corp'> & { html: string },
  headers: Readonly<Record<string, string>> = {},
): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  baseHeaders(res, deps.corp);
  res.status(status).set({
    ...headers,
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
  });
  res.send(deps.html);
}

/**
 * `GET /api/v1/media/:kind/:id/:variant?v&exp&sig` (ADR-141). Thứ tự: zod ⇒ chữ ký (constant-time) — sai /
 * hết hạn ⇒ 404 KHÔNG chạm DB, KHÔNG chạm đĩa (F-10) ⇒ kiểm DB mỗi lần (B M4) ⇒ mở blob (mất ⇒ 404 + log
 * cảnh báo, không 500 — F-09) ⇒ `pipeline(stream, res)` (client hủy ⇒ fd được đóng — B L-b). Query không
 * bao giờ vào log (pino chỉ ghi path; Sentry bỏ query).
 */
export function mediaRouter(deps: MediaRouterDeps): Router {
  const router = express.Router();
  const page = { corp: deps.corp, html: mediaErrorHtml(deps.backUrl) };
  if (deps.rateLimit) router.use(deps.rateLimit);

  router.get('/:kind/:id/:variant', async (req, res, next) => {
    const kind = req.params['kind'] as MediaKind;
    const { id, variant } = req.params;
    const query = Query.safeParse(req.query);
    const shapeOk =
      (kind === 'avatars' || kind === 'chat') && UUID.safeParse(id).success && query.success;
    if (!shapeOk || !isVariantOf(kind, variant ?? '')) {
      deps.logger.debug({ kind, reason: 'format' }, 'media.sig_invalid');
      sendError(res, 404, page);
      return;
    }
    const tuple = {
      kind,
      id: (id ?? '').toLowerCase(),
      variant: variant as MediaVariant,
      version: Number(query.data.v),
      exp: Number(query.data.exp),
    };
    const nowSec = Math.floor(deps.clock.now().getTime() / 1000);
    if (!verifyMedia(deps.secrets, tuple, query.data.sig, nowSec)) {
      const reason = nowSec >= tuple.exp ? 'expired' : 'signature';
      deps.logger.debug({ kind, variant, reason }, 'media.sig_invalid');
      sendError(res, 404, page);
      return;
    }
    try {
      const target = await deps.resolver.resolve(tuple);
      if (!target) {
        sendError(res, 404, page);
        return;
      }
      const { stream, sizeBytes } = await deps.store.open(target.key);
      baseHeaders(res, deps.corp);
      if (target.as === 'image') {
        res.set({
          'Content-Type': 'image/webp',
          'Content-Disposition': 'inline',
          // Không `immutable` vượt hạn URL (E1): cache tới hết khung của chính URL này.
          'Cache-Control': `private, max-age=${Math.max(0, tuple.exp - nowSec)}`,
          ETag: `"${tuple.kind}-${tuple.id}-${tuple.variant}-${tuple.version}"`,
        });
      } else {
        res.set({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': attachmentDisposition(target.name),
          'Cache-Control': 'no-store',
        });
      }
      if (target.as === 'image' && req.fresh) {
        stream.destroy();
        res.status(304).end();
        return;
      }
      res.set('Content-Length', String(sizeBytes));
      await pipeline(stream, res);
    } catch (err) {
      if (err instanceof FileMissingError) {
        deps.logger.warn({ kind, variant }, 'media.blob_missing');
        sendError(res, 404, page);
        return;
      }
      if (res.headersSent || res.destroyed) return; // client hủy giữa chừng — pipeline đã đóng fd
      next(err);
    }
  });

  const errors: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    if (err instanceof RateLimitedError) {
      sendError(res, 429, page, err.headers);
      return;
    }
    deps.logger.error({ err }, 'media.failed');
    sendError(res, 500, page);
  };
  router.use(errors);
  return router;
}
