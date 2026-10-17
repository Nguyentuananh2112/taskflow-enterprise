import { randomBytes, randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import {
  TEST_FILE_URL_SECRET,
  expectMedia404,
  nowSec,
  signMediaUrl,
  useChatApi,
} from './harness/chat';
import { secCase } from './harness/suite';
import { media } from './harness/upload';

// Mốc 6 — xoay khóa ký URL `/media` (ADR-141 B M3, T-067; test-spec-chat SEC-CH-35 vế `_PREVIOUS`). File riêng vì phải
// restart API với bộ khóa khác. Thước đo như chat-media.sec.ts: log debug `media.sig_invalid` (không có ⇒ qua chữ ký).

const NEW_SECRET = `rotated-${randomBytes(24).toString('hex')}`;
const { api } = useChatApi({
  LOG_LEVEL: 'debug',
  FILE_URL_SECRET: NEW_SECRET,
  FILE_URL_SECRET_PREVIOUS: TEST_FILE_URL_SECRET,
});
const AREA = 'Mốc 6 /media xoay khóa (T-067)';

async function passesSignature(url: string): Promise<boolean> {
  const before = api.logs().filter((l) => l.includes('media.sig_invalid')).length;
  const res = await media(api, url);
  expectMedia404(res, url.slice(0, 60));
  await new Promise((r) => setTimeout(r, 150));
  return api.logs().filter((l) => l.includes('media.sig_invalid')).length === before;
}

const urlWith = (secret: string) =>
  signMediaUrl(
    { kind: 'avatars', id: randomUUID(), variant: '64', version: 2, exp: nowSec() + 600 },
    { secret },
  );

describe('xoay khóa', () => {
  secCase(
    'SEC-CH-35',
    'trong lúc xoay: URL ký bằng khóa CŨ (`FILE_URL_SECRET_PREVIOUS`) và khóa mới đều qua chữ ký, khóa lạ thì không; bỏ `_PREVIOUS` (restart) ⇒ URL khóa cũ bị chặn, khóa mới vẫn qua',
    AREA,
    async () => {
      expect(
        await passesSignature(urlWith(TEST_FILE_URL_SECRET)),
        'khóa cũ khi còn _PREVIOUS',
      ).toBe(true);
      expect(await passesSignature(urlWith(NEW_SECRET)), 'khóa mới').toBe(true);
      expect(await passesSignature(urlWith(randomBytes(32).toString('hex'))), 'khóa lạ').toBe(
        false,
      );

      await api.restart({ FILE_URL_SECRET_PREVIOUS: '' });
      expect(
        await passesSignature(urlWith(TEST_FILE_URL_SECRET)),
        'khóa cũ sau khi bỏ _PREVIOUS',
      ).toBe(false);
      expect(await passesSignature(urlWith(NEW_SECRET)), 'khóa mới sau restart').toBe(true);
    },
    60_000,
  );
});
