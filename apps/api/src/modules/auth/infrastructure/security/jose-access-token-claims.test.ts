// QA B.4 P1 (T-017 → T-020): token ký bằng khóa THẬT nhưng claim sai kiểu/rỗng phải bị từ chối ở
// toClaims — đặc biệt `sid` rỗng sẽ tra sai khóa `auth:sid-revoked:` và né thu hồi phiên.
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import type { IClock } from '../../../../core/domain';
import {
  JoseAccessTokenService,
  deriveKeyId,
  type AccessTokenConfig,
} from './jose-access-token-service';

const S1 = 'test-only-secret-one-0123456789abcdef';
const T0 = new Date('2026-11-01T00:00:00.000Z');
const SUBJECT = {
  sub: '0199a1b2-0000-7000-8000-000000000001',
  tv: 3,
  sid: '0199a1b2-0000-7000-8000-0000000000f1',
};
const clock: IClock = { now: () => T0 };

const make = (over: Partial<AccessTokenConfig> = {}) =>
  new JoseAccessTokenService(
    { secret: S1, issuer: 'taskflow-api', audience: 'taskflow-web', ...over },
    clock,
  );

const forge = (payload: Record<string, unknown>) =>
  new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', kid: deriveKeyId(S1) })
    .setIssuer('taskflow-api')
    .setAudience('taskflow-web')
    .setIssuedAt(Math.floor(T0.getTime() / 1000))
    .setExpirationTime(Math.floor(T0.getTime() / 1000) + 900)
    .sign(new TextEncoder().encode(S1));

describe('JoseAccessTokenService — claim sai kiểu (QA B.4)', () => {
  it.each([
    ['sid rỗng (né khóa sid-revoked)', { ...SUBJECT, sid: '', jti: 'j' }],
    ['sid là số', { ...SUBJECT, sid: 123, jti: 'j' }],
    ['sub rỗng', { ...SUBJECT, sub: '', jti: 'j' }],
    ['jti rỗng', { ...SUBJECT, jti: '' }],
    ['tv số thực', { ...SUBJECT, tv: 1.5, jti: 'j' }],
    ['tv là chuỗi số', { ...SUBJECT, tv: '1', jti: 'j' }],
  ])('QA B.4 P1 (toClaims): token ký đúng nhưng %s ⇒ invalid', async (_label, payload) => {
    expect(await make().verify(await forge(payload))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('QA B.4: iat không phải số ⇒ invalid', async () => {
    // jose khai iat là number — cố ý sai kiểu để mô phỏng claim giả mạo.
    const bad = await new SignJWT({ ...SUBJECT, jti: 'j', iat: 'x' as unknown as number })
      .setProtectedHeader({ alg: 'HS256', kid: deriveKeyId(S1) })
      .setIssuer('taskflow-api')
      .setAudience('taskflow-web')
      .setExpirationTime(Math.floor(T0.getTime() / 1000) + 900)
      .sign(new TextEncoder().encode(S1));
    expect(await make().verify(bad)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('QA B.4: biên độ dài secret — đúng 32 byte được, 31 byte ném', () => {
    expect(() => make({ secret: 'k'.repeat(32) })).not.toThrow();
    expect(() => make({ secret: 'k'.repeat(31) })).toThrow();
  });
});
