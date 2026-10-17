import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetRuntimeConfigForTest, setRuntimeConfig } from '@/shared/config';

import { isApiMediaUrl } from './media-url';

const API = 'http://localhost:4000/api/v1';

describe('isApiMediaUrl (B L1/L2)', () => {
  beforeEach(() =>
    setRuntimeConfig({ apiUrl: API, wsUrl: 'http://localhost:4000', appEnv: 'test' }),
  );
  afterEach(() => resetRuntimeConfigForTest());

  it('đúng origin API + đúng /media/<kind>/ ⇒ true', () => {
    expect(isApiMediaUrl(`${API}/media/chat/abc/file?purpose=download&exp=1&sig=x`, 'chat')).toBe(
      true,
    );
    expect(isApiMediaUrl(`${API}/media/avatars/u/64?v=1&exp=1&sig=x`, 'avatars')).toBe(true);
  });

  it('javascript: / data: / blob: / origin lạ / sai kind / sai path / rỗng ⇒ false', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'blob:http://localhost:4000/xyz',
      'https://evil.example/api/v1/media/chat/a/file',
      `http://localhost:4001/api/v1/media/chat/a/file`,
      `${API}/media/avatars/u/64`,
      `${API}/auth/me`,
      'http://localhost:4000/media/chat/a/file',
      `${API}/media/chat`,
      '',
      null,
      undefined,
      'không phải url',
    ]) {
      expect(isApiMediaUrl(url, 'chat'), String(url)).toBe(false);
    }
  });

  it('chưa có runtime config ⇒ false (đóng an toàn)', () => {
    resetRuntimeConfigForTest();
    expect(isApiMediaUrl(`${API}/media/chat/a/file`, 'chat')).toBe(false);
  });
});
