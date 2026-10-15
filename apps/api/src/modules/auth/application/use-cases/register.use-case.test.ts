import { beforeEach, describe, expect, it } from 'vitest';

import {
  EmailAlreadyExistsError,
  InternalError,
  ResourceConflictError,
  ValidationError,
} from '../../../../core/errors';
import {
  createAuthHarness,
  META,
  NOW,
  PASSWORD,
  type AuthHarness,
} from '../../testing/auth-harness';
import { MAX_REGISTER_ATTEMPTS, RegisterUseCase } from './register.use-case';

let h: AuthHarness;
let register: RegisterUseCase;
const input = (over: Partial<{ email: string; password: string; fullName: string }> = {}) => ({
  email: 'alice@example.com',
  password: PASSWORD,
  fullName: 'Alice Nguyen',
  meta: META,
  ...over,
});
const issueCodes = (fn: () => Promise<unknown>) =>
  fn().then(
    () => expect.unreachable(),
    (err: unknown) => {
      expect(err).toBeInstanceOf(ValidationError);
      return (err as ValidationError).issues.map((i) => `${i.path.join('.')}:${i.code}`);
    },
  );

beforeEach(() => {
  h = createAuthHarness();
  register = new RegisterUseCase({ ...h, provisioner: h.provisioner });
});

describe('RegisterUseCase', () => {
  it('REG-01: một transaction tạo user + workspace + phiên (family mới, hạn 7d/30d)', async () => {
    const result = await register.execute(input());
    expect(h.uow.commits).toBe(1);
    expect(await h.users.rows()).toHaveLength(1);
    expect(h.provisioner.calls).toEqual([
      {
        input: { ownerId: result.user.id, ownerFullName: 'Alice Nguyen', attempt: 0 },
        inTransaction: true,
      },
    ]);
    expect(result.defaultWorkspaceId).toBe('ws-1');
    const [token] = await h.refreshTokens.rows();
    expect(token).toMatchObject({
      userId: result.user.id,
      familyId: result.session.familyId,
      expiresAt: new Date(Date.parse(NOW) + 7 * 86_400_000),
      familyExpiresAt: new Date(Date.parse(NOW) + 30 * 86_400_000),
      userAgent: 'vitest',
      ip: '203.0.113.7',
    });
    expect(result.session.expiresIn).toBe(900);
    const verified = await h.accessTokens.verify(result.session.accessToken);
    expect(verified).toMatchObject({
      ok: true,
      claims: { sub: result.user.id, tv: 0, sid: result.session.familyId },
    });
  });

  it('REG-01: UserRegistered chỉ được publish SAU commit', async () => {
    await register.execute(input());
    expect(h.events.types()).toEqual(['UserRegistered']);
  });

  it('REG-02: email được chuẩn hóa', async () => {
    const result = await register.execute(input({ email: '  Alice@Example.COM ' }));
    expect(result.user.email).toBe('alice@example.com');
  });

  it('REG-03: email đã tồn tại (khác hoa thường) ⇒ 409, không tạo thêm gì, không publish', async () => {
    await register.execute(input());
    const before = {
      users: (await h.users.rows()).length,
      tokens: (await h.refreshTokens.rows()).length,
    };
    await expect(register.execute(input({ email: 'ALICE@example.com' }))).rejects.toBeInstanceOf(
      EmailAlreadyExistsError,
    );
    expect({
      users: (await h.users.rows()).length,
      tokens: (await h.refreshTokens.rows()).length,
    }).toEqual(before);
    expect(h.uow.rollbacks).toBe(1);
    expect(h.provisioner.calls).toHaveLength(1); // lần 2 dừng ở unique constraint, chưa tới workspace
    expect(h.events.types()).toEqual(['UserRegistered']);
  });

  it('REG-04/05/06/07: chính sách mật khẩu ⇒ 400 và KHÔNG gọi hasher', async () => {
    await expect(
      issueCodes(() => register.execute(input({ password: 'a'.repeat(11) }))),
    ).resolves.toEqual(['password:too_small']);
    await expect(
      issueCodes(() => register.execute(input({ password: 'x7'.repeat(129) }))),
    ).resolves.toEqual(['password:too_big']);
    await expect(
      issueCodes(() => register.execute(input({ password: 'Password123456' }))),
    ).resolves.toEqual(['password:common_password']);
    await expect(
      issueCodes(() => register.execute(input({ password: 'my-alice-secret-1' }))),
    ).resolves.toEqual(['password:contains_email']);
    expect(h.hasher.calls).toEqual([]);
    expect(h.uow.steps).toEqual([]);
  });

  it('REG-04/05: 12 ký tự và 100 ký tự tiếng Việt có dấu đều hợp lệ', async () => {
    await expect(register.execute(input({ password: 'zt7-kLm9-pQ2' }))).resolves.toBeDefined();
    const vi = 'Mật khẩu dài của tôi '.repeat(5).slice(0, 100);
    await expect(
      register.execute(input({ email: 'b@example.com', password: vi })),
    ).resolves.toBeDefined();
  });

  it('REG-08: fullName rỗng / 101 ký tự ⇒ 400 trước khi băm; "  Alice " ⇒ lưu "Alice"', async () => {
    await expect(issueCodes(() => register.execute(input({ fullName: '   ' })))).resolves.toEqual([
      'fullName:too_small',
    ]);
    await expect(
      issueCodes(() => register.execute(input({ fullName: 'a'.repeat(101) }))),
    ).resolves.toEqual(['fullName:too_big']);
    expect(h.hasher.calls).toEqual([]);
    expect((await register.execute(input({ fullName: '  Alice ' }))).user.fullName).toBe('Alice');
  });

  it('REG-09: field lạ trong input không lọt vào user (use case không spread input)', async () => {
    const evil = { ...input(), tokenVersion: 99, role: 'OWNER', id: 'attacker-id' };
    const result = await register.execute(evil);
    expect(result.user.id).not.toBe('attacker-id');
    expect((await h.users.rows())[0]?.tokenVersion).toBe(0);
  });

  it('REG-10: hash() được gọi TRƯỚC begin, không trong transaction', async () => {
    await register.execute(input());
    expect(h.hasher.calls).toEqual([{ method: 'hash', inTransaction: false }]);
  });

  it('REG-11: trùng slug ⇒ thử lại cả transaction với attempt tăng dần, không để lại dữ liệu lần trước', async () => {
    h.provisioner.slugConflicts = 2;
    const result = await register.execute(input());
    expect(h.provisioner.calls.map((c) => c.input.attempt)).toEqual([0, 1, 2]);
    expect(h.uow.steps).toEqual(['begin', 'rollback', 'begin', 'rollback', 'begin', 'commit']);
    expect((await h.users.rows()).map((u) => u.id)).toEqual([result.user.id]);
    expect(await h.refreshTokens.rows()).toHaveLength(1);
    expect(h.hasher.calls.filter((c) => c.method === 'hash')).toHaveLength(1); // không băm lại
  });

  it(`REG-12: trùng slug ${MAX_REGISTER_ATTEMPTS} lần ⇒ 500, không có dữ liệu nào`, async () => {
    h.provisioner.slugConflicts = MAX_REGISTER_ATTEMPTS;
    await expect(register.execute(input())).rejects.toBeInstanceOf(InternalError);
    expect(h.provisioner.calls).toHaveLength(MAX_REGISTER_ATTEMPTS);
    expect(await h.users.rows()).toEqual([]);
    expect(await h.refreshTokens.rows()).toEqual([]);
    expect(h.events.published).toEqual([]);
  });

  it('REG-13: provisioner nhận họ tên, KHÔNG nhận email (slug không thể lộ email)', async () => {
    await register.execute(input());
    expect(JSON.stringify(h.provisioner.calls)).not.toContain('example.com');
  });

  it('QA B.4: ResourceConflictError KHÁC slug (vd field name) ⇒ ném lại ngay, không thử lại', async () => {
    const calls: number[] = [];
    h.provisioner.provisionDefault = (input) => {
      calls.push(input.attempt);
      return Promise.reject(new ResourceConflictError({ reason: 'taken', field: 'name' }));
    };
    await expect(register.execute(input())).rejects.toBeInstanceOf(ResourceConflictError);
    expect(calls).toEqual([0]);
  });
});
