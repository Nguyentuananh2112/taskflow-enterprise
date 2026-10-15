import { describe, expect, it } from 'vitest';

import { readPublicRuntimeConfig } from './server-env';

describe('readPublicRuntimeConfig', () => {
  it('đọc API_URL, bỏ / cuối, WS_URL mặc định là origin của API_URL', () => {
    expect(
      readPublicRuntimeConfig({ API_URL: 'http://localhost:4000/api/v1/', APP_ENV: 'local' }),
    ).toEqual({
      apiUrl: 'http://localhost:4000/api/v1',
      wsUrl: 'http://localhost:4000',
      appEnv: 'local',
    });
  });

  it('KHÔNG đặt APP_ENV ⇒ production (an toàn mặc định — T-029)', () => {
    expect(readPublicRuntimeConfig({ API_URL: 'https://api.example.com/api/v1' }).appEnv).toBe(
      'production',
    );
  });

  it('dùng WS_URL và APP_ENV khi có', () => {
    expect(
      readPublicRuntimeConfig({
        API_URL: 'https://api.example.com/api/v1',
        WS_URL: 'https://ws.example.com',
        APP_ENV: 'production',
      }),
    ).toEqual({
      apiUrl: 'https://api.example.com/api/v1',
      wsUrl: 'https://ws.example.com',
      appEnv: 'production',
    });
  });

  it('thiếu API_URL ⇒ throw (fail fast)', () => {
    expect(() => readPublicRuntimeConfig({})).toThrow();
  });

  it.each(['ftp://x.com', 'not-a-url', 'javascript:alert(1)'])(
    'API_URL sai (%s) ⇒ throw',
    (url) => {
      expect(() => readPublicRuntimeConfig({ API_URL: url })).toThrow();
    },
  );

  it('APP_ENV lạ ⇒ throw', () => {
    expect(() =>
      readPublicRuntimeConfig({ API_URL: 'http://localhost:4000/api/v1', APP_ENV: 'prod' }),
    ).toThrow();
  });

  it('chỉ trả đúng tập khóa công khai — env khác (secret) không lọt xuống client', () => {
    const config = readPublicRuntimeConfig({
      API_URL: 'http://localhost:4000/api/v1',
      SENTRY_AUTH_TOKEN: 'secret',
      DATABASE_URL: 'postgres://u:p@h/db',
    });
    expect(Object.keys(config).sort()).toEqual(['apiUrl', 'appEnv', 'wsUrl']);
    expect(JSON.stringify(config)).not.toMatch(/secret|postgres/);
  });
});
