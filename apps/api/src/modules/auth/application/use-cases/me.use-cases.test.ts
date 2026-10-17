import { beforeEach, describe, expect, it } from 'vitest';

import { SessionRevokedError, UnauthorizedError, ValidationError } from '../../../../core/errors';
import { type AuthHarness, createAuthHarness, GHOST_ID } from '../../testing/auth-harness';
import { GetMeQuery } from './get-me.query';
import { UpdateMeUseCase } from './update-me.use-case';

let h: AuthHarness;

beforeEach(() => {
  h = createAuthHarness();
});

describe('GetMeQuery (security.md 1.8)', () => {
  it('trả user + memberships của chính user (lọc ws xóa mềm là việc của reader)', async () => {
    const alice = await h.seedUser();
    h.memberships.byUser.set(alice.id, [
      { workspaceId: 'ws-1', workspaceName: 'Alice WS', slug: 'alice-nguyen', role: 'OWNER' },
    ]);
    const me = await new GetMeQuery(h).execute({ userId: alice.id });
    expect(me).toEqual({
      user: {
        id: alice.id,
        email: 'alice@example.com',
        fullName: 'Alice Nguyen',
        createdAt: alice.createdAt,
      },
      memberships: [
        { workspaceId: 'ws-1', workspaceName: 'Alice WS', slug: 'alice-nguyen', role: 'OWNER' },
      ],
      company: {
        name: 'Công ty Test',
        role: 'EMPLOYEE',
        grants: [],
        permissions: ['attendance:self', 'leave:self', 'workspace:create'],
        status: 'ACTIVE',
        offboardLastDay: null,
      },
    });
  });

  it('Mốc 3.5: không còn thuộc công ty ⇒ 401 SESSION_REVOKED (access token cũ còn hạn)', async () => {
    const alice = await h.seedUser();
    h.company.revoked.add(alice.id);
    await expect(new GetMeQuery(h).execute({ userId: alice.id })).rejects.toBeInstanceOf(
      SessionRevokedError,
    );
  });

  it('user không tồn tại / đã xóa ⇒ 401', async () => {
    const gone = await h.seedUser('gone@example.com', { deleted: true });
    await expect(new GetMeQuery(h).execute({ userId: GHOST_ID })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(new GetMeQuery(h).execute({ userId: gone.id })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe('UpdateMeUseCase (ADR-083)', () => {
  it('ME-01: đổi họ tên (trim); tokenVersion và phiên không đổi', async () => {
    const alice = await h.seedUser();
    const s1 = await h.seedSession(alice);
    const view = await new UpdateMeUseCase(h).execute({
      userId: alice.id,
      fullName: '  Alice Tran ',
    });
    expect(view.fullName).toBe('Alice Tran');
    expect((await h.users.rows())[0]).toMatchObject({ fullName: 'Alice Tran', tokenVersion: 0 });
    expect(
      (await h.refreshTokens.rows()).find((r) => r.familyId === s1.familyId)?.revokedAt,
    ).toBeNull();
    expect(h.uow.commits).toBe(2);
  });

  it('ME-02: rỗng / 101 ký tự / ký tự điều khiển ⇒ 400, không đổi gì', async () => {
    const alice = await h.seedUser();
    for (const fullName of ['  ', 'a'.repeat(101), 'Alice\u0000']) {
      await expect(
        new UpdateMeUseCase(h).execute({ userId: alice.id, fullName }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect((await h.users.rows())[0]?.fullName).toBe('Alice Nguyen');
  });

  it('ME-03: field lạ (email, tokenVersion, id) bị bỏ qua — chỉ fullName được đổi', async () => {
    const alice = await h.seedUser();
    const evil = {
      userId: alice.id,
      fullName: 'Alice',
      email: 'evil@example.com',
      tokenVersion: 99,
      id: 'x',
    };
    await new UpdateMeUseCase(h).execute(evil);
    expect((await h.users.rows())[0]).toMatchObject({
      id: alice.id,
      email: 'alice@example.com',
      tokenVersion: 0,
    });
  });

  it('F3 B-4: user bị xóa giữa lúc đọc và updateProfile (trả false) ⇒ 401, không trả view', async () => {
    const alice = await h.seedUser();
    h.users.updateProfile = () => Promise.resolve(false);
    await expect(
      new UpdateMeUseCase(h).execute({ userId: alice.id, fullName: 'Alice Mới' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect((await h.users.rows())[0]?.fullName).toBe('Alice Nguyen');
  });

  it('user không tồn tại ⇒ 401', async () => {
    await expect(
      new UpdateMeUseCase(h).execute({ userId: GHOST_ID, fullName: 'X' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
