import { describe, expect, it } from 'vitest';

import {
  REFRESH_ABSOLUTE_TTL_MS,
  REFRESH_ROTATION_GRACE_MS,
  REFRESH_SLIDING_TTL_MS,
  RefreshToken,
} from './refresh-token';

const NOW = new Date('2026-11-01T00:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const DAY = 86_400_000;

const issue = (familyExpiresAt = at(REFRESH_ABSOLUTE_TTL_MS)) =>
  RefreshToken.issue({
    id: 't1',
    userId: 'u1',
    tokenHash: 'a'.repeat(64),
    familyId: 'f1',
    familyExpiresAt,
    now: NOW,
    meta: { userAgent: 'UA', ip: '203.0.113.7' },
  });

describe('RefreshToken (security.md 1.3–1.4)', () => {
  it('hằng số: trượt 7 ngày, tuyệt đối 30 ngày, ân hạn 10 giây', () => {
    expect(REFRESH_SLIDING_TTL_MS).toBe(7 * DAY);
    expect(REFRESH_ABSOLUTE_TTL_MS).toBe(30 * DAY);
    expect(REFRESH_ROTATION_GRACE_MS).toBe(10_000);
  });

  it('issue: expiresAt = now + 7d khi còn xa hạn tuyệt đối; chưa thu hồi', () => {
    const t = issue();
    expect(t.expiresAt).toEqual(at(7 * DAY));
    expect(t.familyExpiresAt).toEqual(at(30 * DAY));
    expect(t.revokedAt).toBeNull();
    expect(t.revokedReason).toBeNull();
    expect(t.replacedById).toBeNull();
    expect(t.assess(NOW)).toBe('valid');
  });

  it('issue: expiresAt = min(now + 7d, familyExpiresAt) (REF-09)', () => {
    expect(issue(at(3 * DAY)).expiresAt).toEqual(at(3 * DAY));
  });

  it('userAgent cắt còn 255 ký tự', () => {
    const t = RefreshToken.issue({
      id: 't1',
      userId: 'u1',
      tokenHash: 'a'.repeat(64),
      familyId: 'f1',
      familyExpiresAt: at(DAY),
      now: NOW,
      meta: { userAgent: 'x'.repeat(400), ip: null },
    });
    expect(t.userAgent).toHaveLength(255);
    expect(t.ip).toBeNull();
  });

  it('hết hạn trượt (REF-07) / hết hạn tuyệt đối dù expiresAt còn (REF-08) ⇒ expired', () => {
    expect(issue().assess(at(7 * DAY))).toBe('expired');
    const snap = { ...issue().toSnapshot(), expiresAt: at(9 * DAY), familyExpiresAt: at(DAY) };
    expect(RefreshToken.reconstitute(snap).assess(at(DAY))).toBe('expired');
  });

  it('đã xoay < 10s ⇒ superseded (REF-05); ≥ 10s ⇒ reused (REF-04)', () => {
    const rotated = RefreshToken.reconstitute({
      ...issue().toSnapshot(),
      revokedAt: NOW,
      revokedReason: 'ROTATED',
      replacedById: 't2',
    });
    expect(rotated.assess(at(9_999))).toBe('superseded');
    expect(rotated.assess(at(10_000))).toBe('reused');
  });

  it('reuse được phát hiện cả khi token đã xoay nay đã hết hạn', () => {
    const rotated = RefreshToken.reconstitute({
      ...issue().toSnapshot(),
      revokedAt: NOW,
      revokedReason: 'ROTATED',
    });
    expect(rotated.assess(at(40 * DAY))).toBe('reused');
  });

  it.each(['LOGOUT', 'LOGOUT_ALL', 'REUSE_DETECTED', 'PASSWORD_CHANGED', 'USER_DELETED'] as const)(
    'thu hồi với lý do %s ⇒ revoked, không phải reuse (REF-10)',
    (reason) => {
      const t = RefreshToken.reconstitute({
        ...issue().toSnapshot(),
        revokedAt: NOW,
        revokedReason: reason,
      });
      expect(t.assess(at(DAY))).toBe('revoked');
    },
  );

  it('QA B.4: client không gửi User-Agent (undefined) ⇒ userAgent = null, không ném; tokenHash giữ đúng', () => {
    const t = RefreshToken.issue({
      id: 't1',
      userId: 'u1',
      tokenHash: 'b'.repeat(64),
      familyId: 'f1',
      familyExpiresAt: at(DAY),
      now: NOW,
      meta: { userAgent: undefined as unknown as null, ip: null },
    });
    expect(t.userAgent).toBeNull();
    expect(t.tokenHash).toBe('b'.repeat(64));
  });
});
