import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, inject, it } from 'vitest';

import { integrationValkeyUrl } from './global-setup';
import { RUNNING_MARKER } from './serial-guard';

// Khẳng định harness (đợt đỏ hàng loạt do VITEST_MAX_WORKERS=2 chạy 2 file song song cùng DB).
// Hộp đen đầy đủ: e2e/scripts/integration-isolation-gate.mjs (F).
describe('harness integration chạy tuần tự, độc lập env', () => {
  it('VITEST_MAX_WORKERS bị config xóa — kể cả khi shell đã export', () => {
    expect(process.env.VITEST_MAX_WORKERS).toBeUndefined();
  });

  it('serial-guard đang giữ cờ của file này (file thứ hai vào cùng lúc sẽ đỏ)', () => {
    expect(existsSync(join(inject('integrationRunDir'), RUNNING_MARKER))).toBe(true);
  });

  it('Valkey phải là db 1–15 ghi rõ (lượt chạy FLUSHDB db đó)', () => {
    expect(() => integrationValkeyUrl('redis://127.0.0.1:6380')).toThrow(/db 1–15/);
    expect(() => integrationValkeyUrl('redis://127.0.0.1:6380/0')).toThrow(/db 1–15/);
    expect(() => integrationValkeyUrl('redis://:secret@127.0.0.1:6380')).toThrow(/\*\*\*@/);
    expect(integrationValkeyUrl('redis://127.0.0.1:6380/9')).toBe('redis://127.0.0.1:6380/9');
  });
});
