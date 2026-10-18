import { randomBytes, randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import {
  expectMedia404,
  nowSec,
  signMediaUrl,
  useChatApi,
  type MediaTupleInput,
} from './harness/chat';
import { secCase } from './harness/suite';
import { media, parseSignedUrl } from './harness/upload';
import { flushRateLimitCounters } from './harness/valkey';

// Mốc 6 — `/media` URL ký (ADR-141, T-067 G f8ae89e7; test-spec-chat §3): SEC-CH-10 (vế trang lỗi), 11, 20 (vế log
// /media), 31 (vế hạn mức IP), 35 (vế đổi tuple / purpose). T-067 chưa có resolver nào (avatar T-068, chat T-069) ⇒
// URL ký ĐÚNG cũng 404 — nhưng đi qua bước chữ ký. Thước đo hộp đen: log debug `media.sig_invalid {reason}` (G nhận
// 17/10) — có ⇒ bị chặn ở bước chữ ký / định dạng (không chạm DB, không chạm đĩa); không có ⇒ chữ ký đúng.
// Vế cần tệp thật (header ảnh, `deleteBlob`, xóa tin) ⇒ chat-media-files.sec.ts khi có T-068 / T-069.

const { api } = useChatApi({ LOG_LEVEL: 'debug' });
const AREA = 'Mốc 6 /media (T-067)';

const LOG = 'media.sig_invalid';
const sigInvalidLines = () => api.logs().filter((l) => l.includes(LOG));

/** Gửi một request `/media` và trả lý do `media.sig_invalid` mới (hoặc null nếu không có log mới). */
async function probe(url: string, headers: Record<string, string> = {}) {
  const before = sigInvalidLines().length;
  const res = await media(api, url, headers);
  // Log ghi đồng bộ trước khi trả lời, nhưng stdout của process con tới harness bất đồng bộ.
  await new Promise((r) => setTimeout(r, 150));
  const fresh = sigInvalidLines().slice(before);
  const reason =
    fresh.length > 0
      ? ((JSON.parse(fresh.at(-1) ?? '{}') as { reason?: string }).reason ?? '?')
      : null;
  return { res, reason, fresh };
}

const tuple = (over: Partial<MediaTupleInput> = {}): MediaTupleInput => ({
  kind: 'chat',
  id: randomUUID(),
  variant: 'preview',
  version: 1,
  exp: nowSec() + 600,
  ...over,
});

describe('/media — chữ ký, hạn, định dạng', () => {
  secCase(
    'SEC-CH-11',
    'URL ký đúng (id chưa có) ⇒ 404 trang lỗi, KHÔNG log sig_invalid (qua bước chữ ký); sửa exp / sig / path / v, hết hạn ⇒ cùng trang 404 + log reason signature / expired; body và header giống hệt nhau mọi nguyên nhân',
    AREA,
    async () => {
      const t = tuple();
      const good = signMediaUrl(t);
      const ok = await probe(good);
      expectMedia404(ok.res, 'URL ký đúng, id chưa có');
      expect(
        ok.reason,
        'URL ký đúng mà bị chặn ở bước chữ ký — bộ ký của harness lệch API?',
      ).toBeNull();

      const u = parseSignedUrl(good);
      const flipped = `${(u.sig ?? '').slice(0, -1)}${(u.sig ?? '').endsWith('A') ? 'B' : 'A'}`;
      const cases: [string, string, string][] = [
        ['exp + 1', u.with({ exp: String(t.exp + 1) }), 'signature'],
        ['sig sai 1 ký tự', u.with({ sig: flipped }), 'signature'],
        ['v = 2', u.with({ v: '2' }), 'signature'],
        ['id khác', u.with({ path: `/api/v1/media/chat/${randomUUID()}/preview` }), 'signature'],
        ['hết hạn (ký đúng)', signMediaUrl(tuple({ exp: nowSec() - 1 })), 'expired'],
        [
          'ký bằng khóa khác',
          signMediaUrl(t, { secret: randomBytes(32).toString('hex') }),
          'signature',
        ],
      ];
      const bodies = new Set<string>([ok.res.text]);
      for (const [what, url, reason] of cases) {
        const r = await probe(url);
        expectMedia404(r.res, what);
        expect(r.reason, what).toBe(reason);
        bodies.add(r.res.text);
        expect(r.res.headers['cache-control'], what).toBe('no-store');
      }
      expect(bodies.size, 'trang lỗi phải giống hệt nhau mọi nguyên nhân (không lộ lý do)').toBe(1);
    },
  );

  secCase(
    'SEC-CH-35',
    'đổi tuple giữ nguyên sig (kind, variant, version, id) ⇒ 404 reason signature; ký sai purpose (preview ký như download, file ký như view) ⇒ signature; id IN HOA của tuple ký thường ⇒ qua chữ ký (chuẩn hóa)',
    AREA,
    async () => {
      const t = tuple({ kind: 'avatars', variant: '256', version: 3 });
      const url = signMediaUrl(t);
      const u = parseSignedUrl(url);
      for (const [what, swapped] of [
        ['variant 256 → 64', u.with({ path: `/api/v1/media/avatars/${t.id}/64` })],
        ['version 3 → 4', u.with({ v: '4' })],
        [
          'kind avatars → chat (variant hợp lệ của chat)',
          signMediaUrl(
            { ...t, kind: 'chat', variant: 'preview' },
            { sign: { kind: 'avatars', variant: '256', version: 3 } },
          ),
        ],
      ] as const) {
        const r = await probe(swapped);
        expectMedia404(r.res, what);
        expect(r.reason, what).toBe('signature');
      }
      const file = tuple({ variant: 'file' });
      for (const [what, bad] of [
        [
          'preview ký purpose download',
          signMediaUrl(tuple({ variant: 'preview' }), { sign: { purpose: 'download' } }),
        ],
        ['file ký purpose view', signMediaUrl(file, { sign: { purpose: 'view' } })],
      ] as const) {
        const r = await probe(bad);
        expectMedia404(r.res, what);
        expect(r.reason, what).toBe('signature');
      }
      const upper = parseSignedUrl(signMediaUrl(file));
      const r = await probe(
        upper.with({ path: `/api/v1/media/chat/${file.id.toUpperCase()}/file` }),
      );
      expectMedia404(r.res, 'id in hoa');
      expect(r.reason, 'id in hoa của tuple ký thường phải qua chữ ký').toBeNull();
    },
  );

  secCase(
    'SEC-CH-10',
    'trang lỗi /media: 404, text/html, CSP default-src none + frame-ancestors none + sandbox, nosniff, Referrer-Policy no-referrer, CORP = MEDIA_CORP (same-site mặc định), không JSON, không script; định dạng sai (kind, variant không thuộc kind, id không UUID, query thiếu / thừa) ⇒ reason format',
    AREA,
    async () => {
      const t = tuple();
      const base = parseSignedUrl(signMediaUrl(t));
      const sigOf = base.sig ?? '';
      const formats: [string, string][] = [
        ['kind lạ', `/api/v1/media/files/${t.id}/preview?v=1&exp=${String(t.exp)}&sig=${sigOf}`],
        [
          'variant không thuộc kind',
          `/api/v1/media/avatars/${t.id}/preview?v=1&exp=${String(t.exp)}&sig=${sigOf}`,
        ],
        [
          'id không UUID',
          `/api/v1/media/chat/..%2F..%2Fetc/preview?v=1&exp=${String(t.exp)}&sig=${sigOf}`,
        ],
        ['thiếu sig', `/api/v1/media/chat/${t.id}/preview?v=1&exp=${String(t.exp)}`],
        ['sig 42 ký tự', base.with({ sig: sigOf.slice(1) })],
        ['v = 0', base.with({ v: '0' })],
        ['query thừa', `${signMediaUrl(t)}&download=1`],
      ];
      for (const [what, url] of formats) {
        const r = await probe(url);
        expectMedia404(r.res, what);
        expect(r.reason, what).toBe('format');
        const h = r.res.headers;
        const csp = String(h['content-security-policy']);
        expect(csp, what).toContain("default-src 'none'");
        expect(csp, what).toContain("frame-ancestors 'none'");
        expect(h['x-content-type-options'], what).toBe('nosniff');
        expect(h['referrer-policy'], what).toBe('no-referrer');
        expect(h['cross-origin-resource-policy'], what).toBe('same-site');
        expect(r.res.text, what).not.toMatch(/<script/i);
        expect(h['set-cookie'], what).toBeUndefined();
      }
    },
  );

  secCase(
    'SEC-CH-20',
    'log của /media không chứa `sig`, `exp=` hay query string (chỉ path) — kể cả khi debug',
    AREA,
    async () => {
      const t = tuple();
      const url = signMediaUrl(t);
      const sig = parseSignedUrl(url).sig ?? '';
      await probe(url);
      await probe(parseSignedUrl(url).with({ exp: String(t.exp + 7) }));
      const logs = api.logs().join('\n');
      expect(logs).not.toContain(sig);
      expect(logs).not.toContain(`exp=${String(t.exp)}`);
      expect(logs).not.toContain('sig=');
    },
  );
});

describe('/media — hạn mức IP', () => {
  secCase(
    'SEC-CH-31',
    '601 GET /media cùng IP trong một phút ⇒ request 601 nhận 429 trang HTML (cùng header an toàn); IP khác vẫn qua',
    AREA,
    async () => {
      await flushRateLimitCounters();
      const ip = `203.0.113.${String(1 + Math.floor(Math.random() * 200))}`;
      const url = signMediaUrl(tuple());
      const statuses: number[] = [];
      for (let i = 0; i < 600; i += 1) {
        statuses.push((await media(api, url, { 'x-forwarded-for': ip })).status);
      }
      expect(
        statuses.filter((s) => s === 429),
        '600 lần đầu không bị chặn',
      ).toEqual([]);
      const limited = await media(api, url, { 'x-forwarded-for': ip });
      expect(limited.status).toBe(429);
      expect(String(limited.headers['content-type'])).toMatch(/^text\/html/);
      expect(String(limited.headers['content-security-policy'])).toContain('sandbox');
      expect(limited.headers['x-content-type-options']).toBe('nosniff');
      expect(limited.json).toBeUndefined();
      const other = await media(api, url, { 'x-forwarded-for': '198.51.100.7' });
      expect(other.status).toBe(404);
      await flushRateLimitCounters();
    },
    120_000,
  );
});
