import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';

import type { IClock } from '../../../../core/domain';
import {
  JoseAccessTokenService,
  deriveKeyId,
  type AccessTokenConfig,
} from './jose-access-token-service';

const S1 = 'test-only-secret-one-0123456789abcdef';
const S2 = 'test-only-secret-two-0123456789abcdef';
const S3 = 'test-only-secret-three-0123456789abcd';
const T0 = new Date('2026-11-01T00:00:00.000Z');
const SUBJECT = {
  sub: '0199a1b2-0000-7000-8000-000000000001',
  tv: 3,
  sid: '0199a1b2-0000-7000-8000-0000000000f1',
};

class FakeClock implements IClock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

const make = (over: Partial<AccessTokenConfig> = {}, clock = new FakeClock(T0)) =>
  new JoseAccessTokenService(
    { secret: S1, issuer: 'taskflow-api', audience: 'taskflow-web', ...over },
    clock,
  );

/** Ký thủ công bằng jose để tạo token "gần đúng" cho các ca tấn công. */
const forge = (payload: Record<string, unknown>, secret = S1, alg = 'HS256') =>
  new SignJWT(payload)
    .setProtectedHeader({ alg, kid: deriveKeyId(secret) })
    .setIssuer('taskflow-api')
    .setAudience('taskflow-web')
    .setIssuedAt(Math.floor(T0.getTime() / 1000))
    .setExpirationTime(Math.floor(T0.getTime() / 1000) + 900)
    .sign(new TextEncoder().encode(secret));

describe('JoseAccessTokenService (security.md 2.1)', () => {
  it('ký rồi verify: đủ claims, TTL 900s, header HS256 + kid, không có role/email/workspace', async () => {
    const svc = make();
    const { token, expiresIn } = await svc.sign(SUBJECT);
    expect(expiresIn).toBe(900);
    expect(decodeProtectedHeader(token)).toEqual({
      alg: 'HS256',
      kid: deriveKeyId(S1),
      typ: 'JWT',
    });
    const payload = decodeJwt(token);
    expect(Object.keys(payload).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'jti',
      'sid',
      'sub',
      'tv',
    ]);
    const result = await svc.verify(token);
    if (!result.ok) expect.unreachable('token hợp lệ phải verify được');
    const { jti, ...rest } = result.claims;
    expect(jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(rest).toEqual({ ...SUBJECT, iat: T0.getTime() / 1000, exp: T0.getTime() / 1000 + 900 });
  });

  it('mỗi token có jti khác nhau', async () => {
    const svc = make();
    expect(decodeJwt((await svc.sign(SUBJECT)).token).jti).not.toBe(
      decodeJwt((await svc.sign(SUBJECT)).token).jti,
    );
  });

  it('hết hạn: 904s sau khi ký vẫn qua (clockTolerance 5s), 906s ⇒ expired', async () => {
    const clock = new FakeClock(T0);
    const svc = make({}, clock);
    const { token } = await svc.sign(SUBJECT);
    clock.advance(904);
    expect((await svc.verify(token)).ok).toBe(true);
    clock.advance(2);
    expect(await svc.verify(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('chữ ký bị sửa / payload bị sửa ⇒ invalid', async () => {
    const svc = make();
    const { token } = await svc.sign(SUBJECT);
    const [h, p, s = ''] = token.split('.');
    const flipped = `${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(await svc.verify(`${h}.${p}.${flipped}`)).toEqual({ ok: false, reason: 'invalid' });
    const evil = Buffer.from(JSON.stringify({ ...decodeJwt(token), sub: 'someone-else' })).toString(
      'base64url',
    );
    expect(await svc.verify(`${h}.${evil}.${s}`)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('alg: none ⇒ invalid', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: deriveKeyId(S1) })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        ...SUBJECT,
        iss: 'taskflow-api',
        aud: 'taskflow-web',
        exp: T0.getTime() / 1000 + 900,
      }),
    ).toString('base64url');
    expect(await make().verify(`${header}.${payload}.`)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('thuật toán khác HS256 dù đúng secret (HS512) ⇒ invalid', async () => {
    expect(await make().verify(await forge({ ...SUBJECT, jti: 'j' }, S1, 'HS512'))).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('ký bằng secret khác ⇒ invalid', async () => {
    expect(await make().verify((await make({ secret: S2 }).sign(SUBJECT)).token)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('sai iss / sai aud ⇒ invalid', async () => {
    const svc = make();
    expect((await svc.verify((await make({ issuer: 'other' }).sign(SUBJECT)).token)).ok).toBe(
      false,
    );
    expect((await svc.verify((await make({ audience: 'other' }).sign(SUBJECT)).token)).ok).toBe(
      false,
    );
  });

  it.each([
    ['thiếu tv', { sub: SUBJECT.sub, sid: SUBJECT.sid, jti: 'j' }],
    ['thiếu sid', { sub: SUBJECT.sub, tv: 1, jti: 'j' }],
    ['thiếu sub', { tv: 1, sid: SUBJECT.sid, jti: 'j' }],
    ['thiếu jti', { ...SUBJECT }],
    ['tv không phải số nguyên', { ...SUBJECT, tv: '1', jti: 'j' }],
    ['tv âm', { ...SUBJECT, tv: -1, jti: 'j' }],
  ])('%s ⇒ invalid', async (_label, payload) => {
    expect(await make().verify(await forge(payload))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('chuỗi rác / rỗng ⇒ invalid', async () => {
    expect(await make().verify('garbage')).toEqual({ ok: false, reason: 'invalid' });
    expect(await make().verify('')).toEqual({ ok: false, reason: 'invalid' });
  });

  describe('xoay khóa (JWT_ACCESS_SECRET_PREVIOUS)', () => {
    it('token ký bằng khóa cũ vẫn verify được khi khóa cũ là previous; token mới ký bằng khóa mới', async () => {
      const oldToken = (await make({ secret: S1 }).sign(SUBJECT)).token;
      const rotated = make({ secret: S2, previousSecret: S1 });
      expect((await rotated.verify(oldToken)).ok).toBe(true);
      const newToken = (await rotated.sign(SUBJECT)).token;
      expect(decodeProtectedHeader(newToken).kid).toBe(deriveKeyId(S2));
    });

    it('khóa đã bị loại khỏi previous ⇒ token cũ invalid', async () => {
      const oldToken = (await make({ secret: S1 }).sign(SUBJECT)).token;
      expect(await make({ secret: S3, previousSecret: S2 }).verify(oldToken)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('kid không biết / thiếu kid ⇒ invalid', async () => {
      const noKid = await new SignJWT({ ...SUBJECT, jti: 'j' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('taskflow-api')
        .setAudience('taskflow-web')
        .setExpirationTime(T0.getTime() / 1000 + 900)
        .sign(new TextEncoder().encode(S1));
      expect(await make().verify(noKid)).toEqual({ ok: false, reason: 'invalid' });
    });
  });

  it('secret < 32 byte hoặc previous < 32 byte ⇒ ném lỗi lúc khởi tạo', () => {
    expect(() => make({ secret: 'short' })).toThrow();
    expect(() => make({ previousSecret: 'short' })).toThrow();
  });
});
