import { createHash } from 'node:crypto';

import { decodeJwt } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  RefreshInProgressError,
  RefreshTokenInvalidError,
  ServiceUnavailableError,
} from '../../../../core/errors';
import { createAuthHarness, META, type AuthHarness } from '../../testing/auth-harness';
import { RefreshSessionUseCase } from './refresh-session.use-case';

let h: AuthHarness;
let refresh: RefreshSessionUseCase;
const DAY = 86_400_000;

beforeEach(() => {
  h = createAuthHarness();
  refresh = new RefreshSessionUseCase(h);
});

async function seeded() {
  const alice = await h.seedUser();
  const s1 = await h.seedSession(alice);
  return { alice, s1 };
}

describe('RefreshSessionUseCase (security.md 1.4)', () => {
  it('REF-01: xoay — T2 cùng family/hạn tuyệt đối; T1 ROTATED, revokedAt = now, replacedById = T2', async () => {
    const { s1 } = await seeded();
    const [t1Before] = await h.refreshTokens.rows();
    h.clock.advance(60_000);
    const { session } = await refresh.execute({ refreshToken: s1.refreshToken, meta: META });
    const rows = await h.refreshTokens.rows();
    const t1 = rows.find((r) => r.id === t1Before?.id);
    const t2 = rows.find((r) => r.id !== t1Before?.id);
    expect(t2).toMatchObject({
      familyId: s1.familyId,
      familyExpiresAt: t1Before?.familyExpiresAt,
      revokedAt: null,
    });
    expect(t1).toMatchObject({
      revokedReason: 'ROTATED',
      revokedAt: h.clock.now(),
      replacedById: t2?.id,
    });
    expect(session.refreshToken).not.toBe(s1.refreshToken);
    expect(session.familyId).toBe(s1.familyId);
  });

  it('REF-02/03: không có token / token lạ ⇒ REFRESH_TOKEN_INVALID', async () => {
    await expect(refresh.execute({ refreshToken: undefined, meta: META })).rejects.toBeInstanceOf(
      RefreshTokenInvalidError,
    );
    await expect(
      refresh.execute({ refreshToken: 'random-garbage', meta: META }),
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  it('REF-04: dùng lại T1 sau > 10s ⇒ 401; cả family REUSE_DETECTED; sid-revoked; log bảo mật; ngắt socket sau commit', async () => {
    const { alice, s1 } = await seeded();
    await refresh.execute({ refreshToken: s1.refreshToken, meta: META });
    h.clock.advance(11_000);
    await expect(
      refresh.execute({ refreshToken: s1.refreshToken, meta: META }),
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
    const t2 = (await h.refreshTokens.rows()).find((r) => r.replacedById === null);
    expect(t2).toMatchObject({ revokedReason: 'REUSE_DETECTED' });
    expect(h.store.revokedSessions.get(s1.familyId)).toBe(900);
    expect(h.notifier.calls).toEqual([
      { method: 'disconnectSession', args: [s1.familyId], duringTransaction: false },
    ]);
    expect(h.logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'refresh.reuse_detected',
        data: expect.objectContaining({ userId: alice.id, familyId: s1.familyId }) as unknown,
      }),
    );
    expect(JSON.stringify(h.logger.entries)).not.toContain(s1.refreshToken);
  });

  it('REF-05: dùng lại T1 trong < 10s ⇒ 409, T2 vẫn hợp lệ, không cấp token mới', async () => {
    const { s1 } = await seeded();
    const { session: s2 } = await refresh.execute({ refreshToken: s1.refreshToken, meta: META });
    h.clock.advance(5_000);
    await expect(
      refresh.execute({ refreshToken: s1.refreshToken, meta: META }),
    ).rejects.toBeInstanceOf(RefreshInProgressError);
    expect(await h.refreshTokens.rows()).toHaveLength(2);
    await expect(
      refresh.execute({ refreshToken: s2.refreshToken, meta: META }),
    ).resolves.toBeDefined();
  });

  it('REF-06 (mức U): thua race ở markRotated ⇒ 409 và token mới bị rollback', async () => {
    const { s1 } = await seeded();
    const [t1] = await h.refreshTokens.rows();
    // Request khác vừa xoay T1 giữa lúc ta findByHash và markRotated:
    const original = h.refreshTokens.markRotated.bind(h.refreshTokens);
    h.refreshTokens.markRotated = async (id, successor, at) => {
      await original(id, successor, at); // request kia thắng: T1 đã xoay
      return original(id, successor, at);
    };
    await expect(
      refresh.execute({ refreshToken: s1.refreshToken, meta: META }),
    ).rejects.toBeInstanceOf(RefreshInProgressError);
    expect(h.uow.rollbacks).toBe(1);
    expect((await h.refreshTokens.rows()).map((r) => r.id)).toEqual([t1?.id]);
  });

  it('REF-07: quá expiresAt ⇒ 401, family KHÔNG bị thu hồi', async () => {
    const { s1 } = await seeded();
    h.clock.advance(7 * DAY);
    await expect(
      refresh.execute({ refreshToken: s1.refreshToken, meta: META }),
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
    expect((await h.refreshTokens.rows())[0]?.revokedAt).toBeNull();
  });

  /** Xoay liên tục, mỗi lần cách nhau `gapDays` (< 7 để không hết hạn trượt). */
  async function rotateEvery(gapDays: number[], start: { refreshToken: string }) {
    let current = start;
    for (const gap of gapDays) {
      h.clock.advance(gap * DAY);
      ({ session: current } = await refresh.execute({
        refreshToken: current.refreshToken,
        meta: META,
      }));
    }
    return current;
  }

  it('REF-08: xoay đều đặn vẫn hết hạn ở mốc tuyệt đối 30 ngày ⇒ 401', async () => {
    const { s1 } = await seeded();
    const current = await rotateEvery([6, 6, 6, 6, 5], s1); // ngày 29
    h.clock.advance(DAY); // ngày 30 = familyExpiresAt
    await expect(
      refresh.execute({ refreshToken: current.refreshToken, meta: META }),
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  it('REF-09: xoay khi còn 3 ngày tới hạn tuyệt đối ⇒ T mới hết hạn đúng mốc tuyệt đối', async () => {
    const { s1 } = await seeded();
    await rotateEvery([6, 6, 6, 6, 3], s1); // ngày 27
    const live = (await h.refreshTokens.rows()).find((r) => r.revokedAt === null);
    expect(live?.expiresAt).toEqual(new Date(h.clock.now().getTime() + 3 * DAY));
    expect(live?.expiresAt).toEqual(live?.familyExpiresAt);
  });

  it('REF-10: token bị thu hồi do LOGOUT ⇒ 401, không thu hồi thêm, không log reuse', async () => {
    const { s1 } = await seeded();
    await h.refreshTokens.revokeFamily(s1.familyId, 'LOGOUT', h.clock.now());
    h.clock.advance(60_000);
    await expect(
      refresh.execute({ refreshToken: s1.refreshToken, meta: META }),
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
    expect(h.store.ops).toEqual([]);
    expect(h.logger.entries).toEqual([]);
  });

  it('REF-11: user đã xóa ⇒ 401', async () => {
    const alice = await h.seedUser('alice@example.com', { deleted: true });
    const s1 = await h.seedSession(alice);
    await expect(
      refresh.execute({ refreshToken: s1.refreshToken, meta: META }),
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  it('REF-12: tv của access token mới đọc từ DB hiện tại', async () => {
    const alice = await h.seedUser('alice@example.com', { tokenVersion: 3 });
    const s1 = await h.seedSession(alice);
    const { session } = await refresh.execute({ refreshToken: s1.refreshToken, meta: META });
    expect(decodeJwt(session.accessToken).tv).toBe(3);
  });

  it('REF-14: DB chỉ lưu sha256 hex của token, không lưu token thô', async () => {
    const { s1 } = await seeded();
    const { session } = await refresh.execute({ refreshToken: s1.refreshToken, meta: META });
    const stored = JSON.stringify(await h.refreshTokens.rows());
    expect(stored).not.toContain(session.refreshToken);
    expect(stored).toContain(createHash('sha256').update(session.refreshToken).digest('hex'));
  });

  it('ADR-105 (fail-closed): reuse nhưng Valkey lỗi khi ghi sid-revoked ⇒ 503 + rollback (family chưa thu hồi, có thể thử lại)', async () => {
    const { s1 } = await seeded();
    await refresh.execute({ refreshToken: s1.refreshToken, meta: META });
    h.clock.advance(11_000);
    h.store.failing = true;
    await expect(
      refresh.execute({ refreshToken: s1.refreshToken, meta: META }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect((await h.refreshTokens.rows()).some((r) => r.revokedReason === 'REUSE_DETECTED')).toBe(
      false,
    );
    expect(h.notifier.calls).toEqual([]);
  });
});
