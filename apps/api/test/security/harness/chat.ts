import { afterAll, expect } from 'vitest';

import { useCompanyApi } from './company';
import { createTempFileStore, waitNoTmp, type TempFileStore } from './files/store';
import type { RawResponse } from './http-client';
import type { PendingStartup } from './suite';

/**
 * Suite Mốc 6 (test-spec-chat §1.3, §0.4): `useCompanyApi` + kho tệp tạm riêng của file + env cửa sổ test-only
 * (ADR-141 — G T-067 / T-069: đặt khi APP_ENV ≠ test ⇒ API từ chối khởi động). File nào cần giá trị khác thì ghi đè.
 */
export const TEST_FILE_URL_SECRET = 'test-only-file-url-secret-0123456789abcdef';

export const CHAT_TEST_WINDOWS: Readonly<Record<string, string>> = {
  CHAT_EDIT_WINDOW_SECONDS: '2',
  MEDIA_URL_DOWNLOAD_TTL_SECONDS: '3',
  MEDIA_URL_IMAGE_BUCKET_SECONDS: '4',
  MEDIA_URL_AVATAR_BUCKET_SECONDS: '6',
  FILES_ORPHAN_TTL_SECONDS: '5',
  UPLOAD_IDLE_TIMEOUT_MS: '2000',
  CHAT_UPLOAD_DAILY_BYTES: String(2 * 1024 * 1024),
  FILE_STORE_USAGE_CACHE_MS: '0',
};

export function chatEnv(
  store: TempFileStore,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    FILE_STORE_DIR: store.dir,
    FILE_URL_SECRET: TEST_FILE_URL_SECRET,
    ...CHAT_TEST_WINDOWS,
    ...extra,
  };
}

/** `useCompanyApi` cho suite chat: tạo kho tạm (đồng bộ, trước beforeAll của useApi), dọn ở afterAll. */
export function useChatApi(extra: Record<string, string> = {}, pending?: PendingStartup) {
  const store = createTempFileStore();
  const company = useCompanyApi(chatEnv(store, extra), pending);
  afterAll(() => store.cleanup());
  return { ...company, store };
}

/** `/media` lỗi: 404 + HTML tối giản, CSP sandbox, không JSON (ADR-141, test-spec-chat §1.4). */
export function expectMedia404(res: RawResponse, what = '/media'): void {
  expect(res.status, `${what}: ${res.text.slice(0, 200)}`).toBe(404);
  expect(String(res.headers['content-type']), what).toMatch(/^text\/html/);
  expect(String(res.headers['content-security-policy']), what).toContain('sandbox');
  expect(res.text, what).toContain('Liên kết đã hết hạn hoặc không còn tồn tại');
  expect(res.json, `${what}: không phải JSON`).toBeUndefined();
}

/** Không còn tệp tạm trong ≤ `withinMs` (SEC-CH-08 / 26 / 27). */
export async function expectNoTmp(store: TempFileStore, withinMs = 2_000): Promise<void> {
  expect(await waitNoTmp(store, withinMs), 'tệp tmp/ còn sót').toEqual([]);
}
