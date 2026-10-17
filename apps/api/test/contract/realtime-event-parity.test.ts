// Đối chiếu event realtime: HỢP ĐỒNG (packages/contracts) ↔ SERVER (apps/api) ↔ WEB (listener + mock).
// Bài học H2 / T-034 M1: mock web phát `project:updated` mà server chưa bao giờ phát ⇒ UI xanh trên
// mock, hỏng trên production. Test này làm CI đỏ khi ba bên lệch nhau:
//   (a) danh sách event server→client của hợp đồng — `Record` gõ theo `ServerToClientEvents` ⇒ hợp
//       đồng thêm event mà quên cập nhật ở đây là TYPECHECK đỏ;
//   (b) server PHẢI có ≥ 1 chỗ emit thật cho MỌI event của hợp đồng, và không emit event ngoài hợp đồng;
//   (c) mọi event web lắng nghe thuộc hợp đồng; mọi event mock web phát thuộc tập server THỰC SỰ phát.
// Cách quét: tĩnh trên mã nguồn (không tính test), chỉ các vị trí EMIT (`#emit(room, 'x'`,
// `.emit('x'`, `createEnvelope(_, 'x'`, object literal `type: 'x',`) — khai báo kiểu (`type: 'x';`,
// union `'a' | 'b'`) KHÔNG tính, để port/interface không làm test xanh giả. Hành vi từng event (payload,
// sau commit, đúng phòng) do test riêng của từng use case / gateway kiểm.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { REALTIME_EVENTS, type ServerToClientEvents } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');

/** (a) Thêm event vào `ServerToClientEvents` mà không thêm ở đây ⇒ lỗi typecheck. */
const SERVER_EVENTS_RECORD: Record<keyof ServerToClientEvents, true> = {
  'task:created': true,
  'task:updated': true,
  'task:moved': true,
  'task:deleted': true,
  'project:updated': true,
  'workspace:access-revoked': true,
  'auth:expired': true,
  'member:role-changed': true,
  'company:access-changed': true,
  'notification:new': true,
  'user:avatar-changed': true,
  'chat:message:new': true,
  'chat:message:updated': true,
  'chat:read': true,
  'chat:conversation:updated': true,
  'chat:conversation:removed': true,
  'chat:typing': true,
};
const SERVER_EVENTS = new Set<string>(Object.keys(SERVER_EVENTS_RECORD));
/**
 * Event đã vào hợp đồng SỚM (để web dựng mock — Mốc 6) nhưng chỗ emit thuộc vé sau. PHẢI rỗng ở cổng gộp
 * cuối của nhánh tích hợp; server đã emit mà còn trong danh sách ⇒ test đỏ (buộc xóa).
 */
const PENDING_SERVER_EMIT: Readonly<Record<string, string>> = {
  'user:avatar-changed': 'T-068',
  'chat:message:new': 'T-070',
  'chat:message:updated': 'T-070',
  'chat:read': 'T-070',
  'chat:conversation:updated': 'T-070',
  'chat:conversation:removed': 'T-070',
  'chat:typing': 'T-070',
};
// `chat:typing` hai chiều (cùng tên client→server và server→client — ADR-145).
const CLIENT_EVENTS = new Set(['project:join', 'project:leave', 'auth:renew', 'chat:typing']);
const EVENT = String.raw`([a-z]+:[a-z-]+)`;

function sourceFiles(dir: string, keep: (path: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'generated')
        out.push(...sourceFiles(path, keep));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && keep(path)) {
      out.push(path);
    }
  }
  return out;
}

/** Tên event ở mọi vị trí khớp một trong các mẫu, kèm file để báo lỗi dễ đọc. */
function collect(files: string[], patterns: RegExp[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const name = match[1]!;
        found.set(name, [...(found.get(name) ?? []), relative(ROOT, file)]);
      }
    }
  }
  return found;
}

const API_EMIT_PATTERNS = [
  new RegExp(String.raw`#emit\([^,]+,\s*'${EVENT}'`, 'g'),
  new RegExp(String.raw`\.emit\(\s*'${EVENT}'`, 'g'),
  new RegExp(String.raw`createEnvelope\([^,]+,\s*'${EVENT}'`, 'g'),
  new RegExp(String.raw`\btype:\s*'${EVENT}'\s*,`, 'g'),
];
const MOCK_EMIT_PATTERNS = [
  new RegExp(String.raw`\bname:\s*'${EVENT}'`, 'g'),
  new RegExp(String.raw`\benvelope\([^,]+,\s*'${EVENT}'`, 'g'),
  new RegExp(String.raw`\btype:\s*'${EVENT}'\s*,`, 'g'),
  new RegExp(String.raw`\.emit\(\s*'${EVENT}'`, 'g'),
];

const apiEmitted = collect(sourceFiles(join(ROOT, 'apps/api/src')), API_EMIT_PATTERNS);

describe('(a) hợp đồng', () => {
  it('REALTIME_EVENTS = event client→server ∪ server→client (không thừa, không thiếu)', () => {
    expect(new Set(Object.values(REALTIME_EVENTS))).toEqual(
      new Set([...CLIENT_EVENTS, ...SERVER_EVENTS]),
    );
  });
});

describe('(b) server ↔ hợp đồng', () => {
  it.each([...SERVER_EVENTS].filter((e) => !(e in PENDING_SERVER_EMIT)))(
    'server có ít nhất một chỗ emit thật cho %s',
    (event) => {
      expect(
        apiEmitted.get(event),
        `không tìm thấy chỗ emit '${event}' trong apps/api/src`,
      ).toBeDefined();
    },
  );

  it.each(Object.entries(PENDING_SERVER_EMIT))(
    'chờ emit: %s (vé %s) — server đã emit ⇒ xóa khỏi PENDING_SERVER_EMIT',
    (event) => {
      expect(SERVER_EVENTS.has(event)).toBe(true);
      expect(apiEmitted.get(event)).toBeUndefined();
    },
  );

  it('server không emit event nằm ngoài hợp đồng', () => {
    const outside = [...apiEmitted.keys()].filter((e) => !SERVER_EVENTS.has(e));
    expect(outside, JSON.stringify(Object.fromEntries(apiEmitted))).toEqual([]);
  });
});

describe('(c) web ↔ hợp đồng ↔ server', () => {
  const webSrc = join(ROOT, 'apps/web/src');
  const listenerFiles = sourceFiles(
    webSrc,
    (p) => /realtime|socket/.test(relative(webSrc, p)) && !p.includes('mock-api'),
  );
  const listened = collect(listenerFiles, [new RegExp(`'${EVENT}'`, 'g')]);

  it('quét được code lắng nghe của web (chống xanh giả khi đổi cấu trúc thư mục)', () => {
    expect(listenerFiles.length).toBeGreaterThan(0);
    expect(listened.size).toBeGreaterThan(0);
  });

  it('mọi tên event trong code realtime / socket của web đều thuộc hợp đồng', () => {
    const unknown = [...listened.keys()].filter(
      (e) => !SERVER_EVENTS.has(e) && !CLIENT_EVENTS.has(e),
    );
    expect(unknown, JSON.stringify(Object.fromEntries(listened))).toEqual([]);
  });

  it('mọi event mock web phát đều là event server THỰC SỰ phát (bài học H2)', () => {
    const mockFiles = [
      ...sourceFiles(join(webSrc, 'app/mock-api')),
      ...sourceFiles(join(ROOT, 'apps/web/test'), (p) => /fake-realtime/.test(p)),
    ];
    const mockEmitted = collect(mockFiles, MOCK_EMIT_PATTERNS);
    expect(mockEmitted.size).toBeGreaterThan(0);
    const notOnServer = [...mockEmitted.keys()].filter((e) => !apiEmitted.has(e));
    expect(notOnServer, JSON.stringify(Object.fromEntries(mockEmitted))).toEqual([]);
  });
});
