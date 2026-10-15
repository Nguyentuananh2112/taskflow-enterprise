import { beforeEach, describe, expect, it } from 'vitest';

import {
  ForbiddenError,
  ResourceConflictError,
  ResourceNotFoundError,
  ValidationError,
} from '../../../../core/errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  type WorkspaceHarness,
} from '../../testing/harness';
import { AddMemberUseCase } from './add-member.use-case';
import { ListMembersQuery } from './list-members.query';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
const caught = (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );

beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
});

describe('AddMemberUseCase', () => {
  const add = () => new AddMemberUseCase(h);

  it('MEM-01: OWNER thêm Nina với role PM ⇒ MemberView', async () => {
    const view = await add().execute(ctx.alice, { email: 'nina@example.com', role: 'PM' });
    expect(view).toEqual({
      userId: 'user-nina',
      email: 'nina@example.com',
      fullName: 'Nina',
      role: 'PM',
      joinedAt: h.clock.now(),
    });
    expect(h.roleOf(ctx.A, 'Nina')).toBe('PM');
  });

  it('MEM-02: PM thêm với role MEMBER / VIEWER', async () => {
    await expect(
      add().execute(ctx.pam, { email: 'nina@example.com', role: 'MEMBER' }),
    ).resolves.toBeDefined();
    h.user('Zed');
    await expect(
      add().execute(ctx.pam, { email: 'zed@example.com', role: 'VIEWER' }),
    ).resolves.toBeDefined();
  });

  it('MEM-03: PM cấp PM/OWNER ⇒ 403 TRƯỚC khi tra user (email lạ vẫn 403, không 404)', async () => {
    for (const role of ['PM', 'OWNER']) {
      expect(
        await caught(add().execute(ctx.pam, { email: 'ghost@example.com', role })),
      ).toBeInstanceOf(ForbiddenError);
    }
    expect(h.uow.steps).toEqual([]);
  });

  it('MEM-04: MEMBER / VIEWER thêm bất kỳ ai ⇒ 403', async () => {
    for (const actor of [ctx.mia, ctx.vic]) {
      expect(
        await caught(add().execute(actor, { email: 'nina@example.com', role: 'VIEWER' })),
      ).toBeInstanceOf(ForbiddenError);
    }
  });

  it('MEM-05: email không có tài khoản ⇒ 404 resource user', async () => {
    const err = await caught(
      add().execute(ctx.alice, { email: 'ghost@example.com', role: 'MEMBER' }),
    );
    expect(err).toBeInstanceOf(ResourceNotFoundError);
    expect((err as ResourceNotFoundError).details).toEqual({ resource: 'user' });
  });

  it('MEM-06: đã là thành viên ⇒ 409, role không đổi', async () => {
    expect(
      await caught(add().execute(ctx.alice, { email: 'mia@example.com', role: 'PM' })),
    ).toBeInstanceOf(ResourceConflictError);
    expect(h.roleOf(ctx.A, 'Mia')).toBe('MEMBER');
  });

  it('MEM-07: email được chuẩn hóa', async () => {
    await expect(
      add().execute(ctx.alice, { email: '  NINA@Example.com ', role: 'MEMBER' }),
    ).resolves.toMatchObject({ userId: 'user-nina' });
  });

  it('MEM-09: role không hợp lệ ⇒ 400', async () => {
    for (const role of ['ADMIN', 'owner', '']) {
      expect(
        await caught(add().execute(ctx.alice, { email: 'nina@example.com', role })),
      ).toBeInstanceOf(ValidationError);
    }
  });
});

describe('ListMembersQuery', () => {
  const list = () => new ListMembersQuery(h);

  it('VIEWER đọc được danh sách, sắp theo thời điểm tham gia', async () => {
    const page = await list().execute(ctx.vic, {});
    expect(page.items.map((m) => m.fullName)).toEqual(['Alice', 'Pam', 'Mia', 'Vic']);
    expect(page.nextAfter).toBeNull();
  });

  it('MLS-01/02 (mức U): q khớp tên/email không phân biệt hoa thường, chỉ trong ws này', async () => {
    expect((await list().execute(ctx.vic, { q: 'MIA' })).items.map((m) => m.userId)).toEqual([
      'user-mia',
    ]);
    expect((await list().execute(ctx.alice, { q: 'bob' })).items).toEqual([]);
  });

  it('MLS-03 (mức U): % và _ khớp theo nghĩa đen', async () => {
    expect((await list().execute(ctx.alice, { q: '%' })).items).toEqual([]);
    expect((await list().execute(ctx.alice, { q: '_' })).items).toEqual([]);
  });

  it('MLS-04: q 101 ký tự ⇒ 400; q chỉ khoảng trắng ⇒ không lọc', async () => {
    expect(await caught(list().execute(ctx.alice, { q: 'a'.repeat(101) }))).toBeInstanceOf(
      ValidationError,
    );
    expect((await list().execute(ctx.alice, { q: '   ' })).items).toHaveLength(4);
  });

  it('phân trang: limit 1–100 (mặc định 50), nextAfter', async () => {
    const first = await list().execute(ctx.alice, { limit: 3 });
    expect(first.items).toHaveLength(3);
    const second = await list().execute(ctx.alice, {
      limit: 3,
      after: first.nextAfter ?? undefined,
    });
    expect(second.items.map((m) => m.fullName)).toEqual(['Vic']);
    expect(second.nextAfter).toBeNull();
    expect(await caught(list().execute(ctx.alice, { limit: 0 }))).toBeInstanceOf(ValidationError);
    expect(await caught(list().execute(ctx.alice, { limit: 101 }))).toBeInstanceOf(ValidationError);
  });
});
