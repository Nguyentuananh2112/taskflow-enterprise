// X9 (T-032): nhiều cookie refresh trùng tên = dấu hiệu cookie tossing ⇒ log `auth.refresh_cookie_ambiguous`
// (số lượng + ip, KHÔNG có giá trị cookie).
import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { RefreshTokenInvalidError } from '../../../core/errors';
import { FakeClock, SpyLogger } from '../../../../test/support';
import { AuthController, type AuthControllerDeps } from './auth.controller';
import { MAX_REFRESH_COOKIES, RefreshCookie } from './refresh-cookie';

function setup() {
  const logger = new SpyLogger();
  const logouts: string[] = [];
  const controller = new AuthController({
    logout: {
      execute: ({ refreshToken }: { refreshToken: string | undefined }) => {
        logouts.push(refreshToken ?? '');
        return Promise.resolve();
      },
    },
    cookie: new RefreshCookie(false, new FakeClock()),
    logger,
  } as unknown as AuthControllerDeps);
  const req = (cookie: string) =>
    ({ headers: { cookie }, ip: '203.0.113.9' }) as unknown as Request;
  const res = { cookie: () => res, status: () => res, end: () => res } as unknown as Response;
  return { controller, logger, logouts, req, res };
}

describe('auth.refresh_cookie_ambiguous', () => {
  it('2 cookie trùng tên ⇒ warn { count: 2, ip }, không chứa giá trị cookie', async () => {
    const { controller, logger, req, res } = setup();
    await expect(
      controller.refresh(req('tf_rt=secret-one; tf_rt=secret-two'), res),
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'auth.refresh_cookie_ambiguous',
        data: { count: 2, ip: '203.0.113.9' },
      }),
    );
    expect(JSON.stringify(logger.entries)).not.toMatch(/secret-one|secret-two/);
  });

  it(`F3 B-7: đúng MAX_REFRESH_COOKIES (${MAX_REFRESH_COOKIES}) giá trị ⇒ thu hồi TỪNG giá trị; thêm 1 ⇒ 401 ngay, không thu hồi gì, vẫn log warn`, async () => {
    const cookies = (n: number) => Array.from({ length: n }, (_, i) => `tf_rt=v${i}`).join('; ');
    const atMax = setup();
    await expect(
      atMax.controller.refresh(atMax.req(cookies(MAX_REFRESH_COOKIES)), atMax.res),
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
    expect(atMax.logouts).toHaveLength(MAX_REFRESH_COOKIES);

    const over = setup();
    await expect(
      over.controller.refresh(over.req(cookies(MAX_REFRESH_COOKIES + 1)), over.res),
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
    expect(over.logouts).toEqual([]);
    expect(over.logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'auth.refresh_cookie_ambiguous',
        data: { count: MAX_REFRESH_COOKIES + 1, ip: '203.0.113.9' },
      }),
    );
  });

  it('1 cookie ⇒ không có sự kiện', async () => {
    const { controller, logger, req, res } = setup();
    await controller.logout(req('tf_rt=only-one'), res);
    expect(logger.messages()).not.toContain('auth.refresh_cookie_ambiguous');
  });
});
