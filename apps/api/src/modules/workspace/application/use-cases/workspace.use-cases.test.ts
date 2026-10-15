import { beforeEach, describe, expect, it } from 'vitest';

import { FakeRandom } from '../../../../../test/support';
import {
  ForbiddenError,
  InternalError,
  ResourceConflictError,
  ValidationError,
} from '../../../../core/errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { MAX_SLUG_ATTEMPTS } from '../slug-rules';
import { CreateWorkspaceUseCase } from './create-workspace.use-case';
import { UpdateWorkspaceUseCase } from './update-workspace.use-case';
import { GetWorkspaceQuery, ListMyWorkspacesQuery } from './workspace.queries';

let h: WorkspaceHarness;
const suffix = (s: string) => [...s].map((c) => parseInt(c, 36));
const fieldOf = (err: unknown) => (err as ResourceConflictError).details?.['field'];
const caught = (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable(),
    (e: unknown) => e,
  );

beforeEach(() => {
  h = createWorkspaceHarness(
    new FakeRandom({
      ints: [
        ...suffix('abc123'),
        ...suffix('def456'),
        ...suffix('ghi789'),
        ...suffix('jkl012'),
        ...suffix('mno345'),
      ],
    }),
  );
});

describe('CreateWorkspaceUseCase', () => {
  const create = () => new CreateWorkspaceUseCase(h);

  it('WSC-01: tạo ws + membership OWNER trong một transaction, myRole = OWNER', async () => {
    const alice = await h.user('Alice');
    const view = await create().execute({ userId: alice, name: 'Marketing', slug: 'marketing' });
    expect(view).toMatchObject({ name: 'Marketing', slug: 'marketing', myRole: 'OWNER' });
    expect(h.uow.commits).toBe(1);
    expect(await h.roleOf(view.id, 'Alice')).toBe('OWNER');
  });

  it('WSC-02: không gửi slug ⇒ sinh từ tên tiếng Việt', async () => {
    const view = await create().execute({
      userId: await h.user('Alice'),
      name: 'Đội Phát Triển Sản Phẩm',
    });
    expect(view.slug).toBe('doi-phat-trien-san-pham');
  });

  it('WSC-04: slug sai định dạng / chữ hoa / tên sai ⇒ 400, không mở transaction', async () => {
    const alice = await h.user('Alice');
    for (const slug of ['Has Space', '-abc', 'abc-', 'a--b', 'ab', 'a'.repeat(51), 'Marketing']) {
      expect(await caught(create().execute({ userId: alice, name: 'X', slug }))).toBeInstanceOf(
        ValidationError,
      );
    }
    for (const name of ['  ', 'a'.repeat(101), 'A\u0000']) {
      expect(await caught(create().execute({ userId: alice, name, slug: 'okay' }))).toBeInstanceOf(
        ValidationError,
      );
    }
    expect(h.uow.steps).toEqual([]);
  });

  it('WSC-04b: biên hợp lệ 3 và 50 ký tự', async () => {
    const alice = await h.user('Alice');
    await expect(
      create().execute({ userId: alice, name: 'A', slug: 'abc' }),
    ).resolves.toBeDefined();
    await expect(
      create().execute({ userId: alice, name: 'B', slug: 'b'.repeat(50) }),
    ).resolves.toBeDefined();
  });

  it('WSC-03 (mức U): slug đã có (kể cả ws đang xóa mềm) ⇒ 409 field slug, không tạo membership', async () => {
    const { A } = await givenWorkspaceA(h);
    const ws = await h.workspaces.findById(A);
    ws?.softDelete(uid('alice'), h.clock.now());
    if (ws) await h.workspaces.save(ws);
    const before = (await h.memberships.rows()).length;
    const err = await caught(
      create().execute({ userId: await h.user('Nina'), name: 'X', slug: 'acme' }),
    );
    expect(err).toBeInstanceOf(ResourceConflictError);
    expect(fieldOf(err)).toBe('slug');
    expect(await h.memberships.rows()).toHaveLength(before);
  });

  it('WSC-05: field lạ (ownerId, deletedAt) bị bỏ qua', async () => {
    const evil = {
      userId: await h.user('Alice'),
      name: 'Evil',
      slug: 'evil',
      ownerId: uid('bob'),
      deletedAt: new Date(),
    };
    const view = await create().execute(evil);
    expect(await h.roleOf(view.id, 'Alice')).toBe('OWNER');
    expect((await h.memberships.rows()).filter((m) => m.workspaceId === view.id)).toHaveLength(1);
    expect((await h.workspaces.rows()).find((w) => w.id === view.id)?.deletedAt).toBeNull();
  });

  it('WSC-08: 13 slug dành riêng ⇒ 409 field slug, cùng lỗi với slug đã có người dùng', async () => {
    const alice = await h.user('Alice');
    await create().execute({ userId: alice, name: 'Taken', slug: 'taken' });
    const taken = await caught(create().execute({ userId: alice, name: 'X', slug: 'taken' }));
    for (const slug of [
      'api',
      'app',
      'www',
      'admin',
      'auth',
      'login',
      'register',
      'settings',
      'workspaces',
      'new',
      'help',
      'support',
      'status',
    ]) {
      const err = await caught(create().execute({ userId: alice, name: 'X', slug }));
      expect(err).toBeInstanceOf(ResourceConflictError);
      expect((err as Error).message).toBe((taken as Error).message);
      expect((err as ResourceConflictError).details).toEqual(
        (taken as ResourceConflictError).details,
      );
    }
  });

  it('WSC-09: slug sinh ra đã có ⇒ thêm hậu tố, thử lại cả transaction', async () => {
    const alice = await h.user('Alice');
    await create().execute({ userId: alice, name: 'Marketing', slug: 'marketing' });
    const view = await create().execute({ userId: alice, name: 'Marketing' });
    expect(view.slug).toBe('marketing-abc123');
    expect(h.uow.steps.slice(-4)).toEqual(['begin', 'rollback', 'begin', 'commit']);
  });

  it(`WSC-09: trùng ${MAX_SLUG_ATTEMPTS} lần ⇒ 500, không để lại dữ liệu`, async () => {
    const alice = await h.user('Alice');
    for (const s of [
      'marketing',
      'marketing-abc123',
      'marketing-def456',
      'marketing-ghi789',
      'marketing-jkl012',
    ]) {
      await create().execute({ userId: alice, name: 'M', slug: s });
    }
    h.random = new FakeRandom({
      ints: [...suffix('abc123'), ...suffix('def456'), ...suffix('ghi789'), ...suffix('jkl012')],
    });
    const before = (await h.workspaces.rows()).length;
    expect(
      await caught(new CreateWorkspaceUseCase(h).execute({ userId: alice, name: 'Marketing' })),
    ).toBeInstanceOf(InternalError);
    expect(await h.workspaces.rows()).toHaveLength(before);
  });

  it('WSC-10: tên ra slug dành riêng ⇒ "workspace-xxxxxx"', async () => {
    expect((await create().execute({ userId: await h.user('Alice'), name: 'Settings' })).slug).toBe(
      'workspace-abc123',
    );
  });
});

describe('GetWorkspaceQuery / ListMyWorkspacesQuery', () => {
  it('GET ws: trả myRole của actor', async () => {
    const { pam } = await givenWorkspaceA(h);
    expect(await new GetWorkspaceQuery(h).execute(pam)).toMatchObject({
      slug: 'acme',
      myRole: 'PM',
    });
  });

  it('list của tôi: chỉ ws chưa xóa; ?deleted=true chỉ ws tôi là OWNER và chưa quá purgeAt', async () => {
    const { A, alice } = await givenWorkspaceA(h);
    const ws = await h.workspaces.findById(A);
    ws?.softDelete(alice.userId, h.clock.now());
    if (ws) await h.workspaces.save(ws);
    const q = new ListMyWorkspacesQuery(h);
    expect(await q.execute({ userId: alice.userId, deleted: false })).toEqual([]);
    expect((await q.execute({ userId: alice.userId, deleted: true })).map((w) => w.id)).toEqual([
      A,
    ]);
    expect(await q.execute({ userId: uid('pam'), deleted: true })).toEqual([]);
    expect(await q.execute({ userId: uid('bob'), deleted: true })).toEqual([]);
  });
});

describe('UpdateWorkspaceUseCase', () => {
  it('WSU-01: OWNER đổi tên', async () => {
    const { alice } = await givenWorkspaceA(h);
    expect(await new UpdateWorkspaceUseCase(h).execute(alice, { name: 'Acme 2' })).toMatchObject({
      name: 'Acme 2',
      myRole: 'OWNER',
    });
  });

  it('WSU-02: PM ⇒ 403', async () => {
    const { pam } = await givenWorkspaceA(h);
    expect(await caught(new UpdateWorkspaceUseCase(h).execute(pam, { name: 'X' }))).toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('WSU-03 (mức U) / WSU-04: slug của ws khác / dành riêng ⇒ 409; chữ hoa ⇒ 400; không field nào ⇒ 400', async () => {
    const { alice } = await givenWorkspaceA(h);
    const update = new UpdateWorkspaceUseCase(h);
    expect(fieldOf(await caught(update.execute(alice, { slug: 'bravo' })))).toBe('slug');
    expect(fieldOf(await caught(update.execute(alice, { slug: 'admin' })))).toBe('slug');
    expect(await caught(update.execute(alice, { slug: 'Beta' }))).toBeInstanceOf(ValidationError);
    expect(await caught(update.execute(alice, {}))).toBeInstanceOf(ValidationError);
    expect((await h.workspaces.rows()).find((w) => w.slug === 'acme')).toBeDefined();
  });
});
