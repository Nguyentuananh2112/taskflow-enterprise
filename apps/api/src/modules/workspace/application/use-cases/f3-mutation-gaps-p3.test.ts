// F3 mutation (report §4.1, workspace — chủ module B): GAP P3 W-12..W-22 (biên, nhánh 404, hợp đồng
// lỗi `details`). Mỗi ca chặn đúng một đột biến còn sống trên main 4ba066b; tên ca mang mã W-x.
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { ForbiddenError, ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import { Project } from '../../domain/project';
import { slugifyName } from '../../domain/names';
import { Workspace } from '../../domain/workspace';
import { FakeRandom } from '../../../../../test/support';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { WorkspaceProjectAccessChecker } from '../adapters/project-access-checker';
import { generateSlug } from '../slug-rules';
import { AddMemberUseCase } from './add-member.use-case';
import { ChangeMemberRoleUseCase } from './change-member-role.use-case';
import { CreateProjectUseCase } from './create-project.use-case';
import { CreateWorkspaceUseCase } from './create-workspace.use-case';
import { DeleteWorkspaceUseCase } from './delete-workspace.use-case';
import { ListMembersQuery, pageLimit } from './list-members.query';
import { GetProjectQuery } from './project.queries';
import { RemoveMemberUseCase } from './remove-member.use-case';
import { RestoreWorkspaceUseCase } from './restore-workspace.use-case';
import { SetProjectArchivedUseCase } from './set-project-archived.use-case';
import { UpdateProjectUseCase } from './update-project.use-case';
import { UpdateWorkspaceUseCase } from './update-workspace.use-case';
import { GetWorkspaceQuery } from './workspace.queries';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
});

const caught = (p: Promise<unknown> | (() => unknown)) =>
  typeof p === 'function'
    ? (() => {
        try {
          p();
        } catch (e) {
          return e;
        }
        return expect.unreachable();
      })()
    : p.then(
        () => expect.unreachable(),
        (e: unknown) => e,
      );
/** `path:code` của mọi issue — như `names.test.ts`. */
const codes = (err: unknown) => {
  expect(err).toBeInstanceOf(ValidationError);
  return (err as ValidationError).issues.map((i) => `${i.path.join('.')}:${i.code}`);
};
const resourceOf = (err: unknown) => {
  expect(err).toBeInstanceOf(ResourceNotFoundError);
  return (err as ResourceNotFoundError).details;
};

/** Xóa mềm ws A trực tiếp trong store (như request khác vừa xóa). */
async function softDeleteA() {
  const ws = (await h.workspaces.findById(ctx.A))!;
  ws.softDelete(ctx.alice.userId, h.clock.now());
  expect(await h.workspaces.save(ws)).toBe(true);
}

describe('F3 workspace — GAP P3: biên', () => {
  it('W-12: slugifyName cắt 40 ký tự trúng dấu "-" ⇒ bỏ "-" cuối', () => {
    expect(slugifyName(`${'a'.repeat(39)} bcd`)).toBe('a'.repeat(39));
  });

  it('W-13: đúng biên là HỢP LỆ — description 2000, limit 1 và 100, q 100 ký tự, gốc slug đúng 3 ký tự', async () => {
    const p = Project.create({
      id: randomUUID(),
      workspaceId: ctx.A,
      name: 'Biên',
      keyPrefix: 'BIE',
      description: 'x'.repeat(2000),
      now: h.clock.now(),
    });
    expect(p.toSnapshot().description).toHaveLength(2000);
    expect(pageLimit(1)).toBe(1);
    expect(pageLimit(100)).toBe(100);
    await expect(
      new ListMembersQuery(h).execute(ctx.alice, { q: 'q'.repeat(100) }),
    ).resolves.toBeDefined();
    expect(generateSlug('Abc', 0, new FakeRandom())).toBe('abc');
  });

  it('W-14: OWNER duy nhất tự đặt lại OWNER (no-op) ⇒ thành công, không LAST_OWNER', async () => {
    await expect(
      new ChangeMemberRoleUseCase(h).execute(ctx.alice, {
        userId: ctx.alice.userId,
        role: 'OWNER',
      }),
    ).resolves.toMatchObject({ member: { role: 'OWNER' } });
  });
});

describe('F3 workspace — GAP P3: nhánh 404 (và `details.resource`, W-21)', () => {
  it('W-15: membership còn nhưng user đã mất khỏi danh bạ ⇒ đổi role 404 user', async () => {
    h.users.findById = () => Promise.resolve(null);
    const err = await caught(
      new ChangeMemberRoleUseCase(h).execute(ctx.alice, { userId: uid('mia'), role: 'PM' }),
    );
    expect(resourceOf(err)).toEqual({ resource: 'user' });
  });

  it('W-16: ws đã xóa mềm ⇒ Delete (confirmSlug sai) 404 chứ không 400; Update 404; Get 404', async () => {
    await softDeleteA();
    const del = await caught(
      new DeleteWorkspaceUseCase(h).execute(ctx.alice, { confirmSlug: 'khong-khop' }),
    );
    expect(resourceOf(del)).toEqual({ resource: 'workspace' });
    // Chặn TRƯỚC khi ghi: ws đã xóa không bao giờ được thử UPDATE (lớp sau — saveWorkspaceOrFail — cũng
    // ra 404 nên chỉ nhìn mã lỗi sẽ không thấy lớp đầu bị gỡ).
    const save = h.workspaces.save.bind(h.workspaces);
    let saves = 0;
    h.workspaces.save = (ws) => {
      saves += 1;
      return save(ws);
    };
    const upd = await caught(new UpdateWorkspaceUseCase(h).execute(ctx.alice, { name: 'Mới' }));
    expect(resourceOf(upd)).toEqual({ resource: 'workspace' });
    expect(saves, 'không ghi ws đã xóa').toBe(0);
    expect(resourceOf(await caught(new GetWorkspaceQuery(h).execute(ctx.alice)))).toEqual({
      resource: 'workspace',
    });
  });

  it('W-21: ghi ws thua rồi đọc lại thấy đã xóa ⇒ 404 workspace (optimistic-save)', async () => {
    h.workspaces.save = () => Promise.resolve(false);
    const find = h.workspaces.findById.bind(h.workspaces);
    let reads = 0;
    h.workspaces.findById = async (id: string) => {
      reads += 1;
      return reads === 1 ? find(id) : null;
    };
    const err = await caught(new UpdateWorkspaceUseCase(h).execute(ctx.alice, { name: 'Mới' }));
    expect(resourceOf(err)).toEqual({ resource: 'workspace' });
  });

  it('W-21: actor mất membership giữa chừng ⇒ 404 workspace (owner-guard)', async () => {
    await h.memberships.remove(ctx.A, ctx.pam.userId);
    const err = await caught(
      new AddMemberUseCase(h).execute(ctx.pam, { userId: uid('nina'), role: 'VIEWER' }),
    );
    expect(resourceOf(err)).toEqual({ resource: 'workspace' });
  });

  it('W-21: project không tồn tại ⇒ GetProject / SetProjectArchived 404 project', async () => {
    const projectId = randomUUID();
    expect(
      resourceOf(await caught(new GetProjectQuery(h).execute(ctx.vic, { projectId }))),
    ).toEqual({ resource: 'project' });
    expect(
      resourceOf(
        await caught(
          new SetProjectArchivedUseCase(h).execute(ctx.pam, { projectId, archived: true }),
        ),
      ),
    ).toEqual({ resource: 'project' });
  });

  it('W-21: khôi phục bị job purge giành trước (restoreIfWithinGrace = false) ⇒ 404 workspace', async () => {
    await softDeleteA();
    h.workspaces.restoreIfWithinGrace = () => Promise.resolve(false);
    const err = await caught(
      new RestoreWorkspaceUseCase(h).execute({ userId: ctx.alice.userId, workspaceId: ctx.A }),
    );
    expect(resourceOf(err)).toEqual({ resource: 'workspace' });
  });
});

describe('F3 workspace — GAP P3: log bảo mật và lỗi hạ tầng', () => {
  it('W-17: PATCH với slug GIỮ NGUYÊN ⇒ không log workspace.slug_changed; slug mới ⇒ có', async () => {
    const ws = (await h.workspaces.findById(ctx.A))!;
    await new UpdateWorkspaceUseCase(h).execute(ctx.alice, { slug: ws.slug });
    expect(h.logger.messages()).not.toContain('workspace.slug_changed');
    await new UpdateWorkspaceUseCase(h).execute(ctx.alice, { slug: 'acme-moi' });
    expect(h.logger.messages()).toContain('workspace.slug_changed');
  });

  it('W-18: lỗi DB khi kiểm quyền vào project ⇒ ném nguyên lỗi (không nuốt thành "không có quyền")', async () => {
    const boom = new Error('db down');
    h.memberships.find = () => Promise.reject(boom);
    const checker = new WorkspaceProjectAccessChecker(h);
    await expect(
      checker.canAccessProject({
        userId: ctx.mia.userId,
        workspaceId: ctx.A,
        projectId: randomUUID(),
      }),
    ).rejects.toBe(boom);
  });
});

describe('F3 workspace — GAP P3: hợp đồng lỗi `details` (W-20, W-22)', () => {
  it('W-20: issues của ValidationError — đúng path:code ở từng chỗ ném', async () => {
    const add = new AddMemberUseCase(h);
    expect(
      codes(await caught(add.execute(ctx.alice, { userId: uid('nina'), role: 'ADMIN' }))),
    ).toEqual(['role:invalid_value']);
    expect(
      codes(await caught(new DeleteWorkspaceUseCase(h).execute(ctx.alice, { confirmSlug: 'sai' }))),
    ).toEqual(['confirmSlug:mismatch']);
    expect(codes(caught(() => pageLimit(0)))).toEqual(['limit:too_big']);
    expect(
      codes(await caught(new ListMembersQuery(h).execute(ctx.alice, { q: 'q'.repeat(101) }))),
    ).toEqual(['q:too_big']);
    expect(codes(await caught(new UpdateWorkspaceUseCase(h).execute(ctx.alice, {})))).toEqual([
      ':too_small',
    ]);
    const projectId = await h.project(ctx.A, 'API');
    expect(
      codes(await caught(new UpdateProjectUseCase(h).execute(ctx.alice, { projectId }))),
    ).toEqual([':too_small']);
    const alice = ctx.alice.userId;
    const create = new CreateWorkspaceUseCase(h);
    expect(codes(await caught(create.execute({ userId: alice, name: '  ' })))).toEqual([
      'name:too_small',
    ]);
    expect(
      codes(await caught(create.execute({ userId: alice, name: 'Ok', slug: 'Bad Slug' }))),
    ).toEqual(['slug:invalid_format']);
    expect(
      codes(
        await caught(new CreateProjectUseCase(h).execute(ctx.pam, { name: '', keyPrefix: 'ABC' })),
      ),
    ).toEqual(['name:too_small']);
    expect(
      codes(await caught(new UpdateProjectUseCase(h).execute(ctx.alice, { projectId, name: '' }))),
    ).toEqual(['name:too_small']);
    expect(
      codes(await caught(new UpdateWorkspaceUseCase(h).execute(ctx.alice, { name: '' }))),
    ).toEqual(['name:too_small']);
    // Domain trực tiếp (use case đã chuẩn hóa tên trước ⇒ nhánh này chỉ bắt được ở domain).
    expect(
      codes(
        caught(() =>
          Workspace.create({ id: randomUUID(), name: '', slug: 'abc', now: h.clock.now() }),
        ),
      ),
    ).toEqual(['name:too_small']);
    expect(
      codes(
        caught(() =>
          Project.create({
            id: randomUUID(),
            workspaceId: ctx.A,
            name: '',
            keyPrefix: 'ABC',
            description: null,
            now: h.clock.now(),
          }),
        ),
      ),
    ).toEqual(['name:too_small']);
  });

  it('W-22: details.required của 403 — PM cấp OWNER (member:add), PM xóa OWNER (member:remove)', async () => {
    const grant = await caught(
      new AddMemberUseCase(h).execute(ctx.pam, { userId: uid('nina'), role: 'OWNER' }),
    );
    expect(grant).toBeInstanceOf(ForbiddenError);
    expect((grant as ForbiddenError).details).toEqual({ required: 'member:add' });
    const remove = await caught(
      new RemoveMemberUseCase(h).execute(ctx.pam, { userId: ctx.alice.userId }),
    );
    expect(remove).toBeInstanceOf(ForbiddenError);
    expect((remove as ForbiddenError).details).toEqual({ required: 'member:remove' });
  });
});
