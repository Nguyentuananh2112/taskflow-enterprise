import { beforeEach, describe, expect, it } from 'vitest';

import {
  ForbiddenError,
  ProjectArchivedError,
  ResourceConflictError,
  ResourceNotFoundError,
  ValidationError,
} from '../../../../core/errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  type WorkspaceHarness,
} from '../../testing/harness';
import { CreateProjectUseCase } from './create-project.use-case';
import { GetProjectQuery, ListProjectsQuery } from './project.queries';
import { SetProjectArchivedUseCase } from './set-project-archived.use-case';
import { UpdateProjectUseCase } from './update-project.use-case';

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

describe('CreateProjectUseCase', () => {
  const create = () => new CreateProjectUseCase(h);

  it('PRJ-01: PM tạo project; workspaceId lấy từ actor (URL)', async () => {
    const view = await create().execute(ctx.pam, { name: 'Website', keyPrefix: 'WEB' });
    expect(view).toMatchObject({
      workspaceId: ctx.A,
      name: 'Website',
      keyPrefix: 'WEB',
      isArchived: false,
      archivedAt: null,
      description: null,
    });
  });

  it('PRJ-02: MEMBER / VIEWER ⇒ 403', async () => {
    for (const actor of [ctx.mia, ctx.vic]) {
      expect(await caught(create().execute(actor, { name: 'X', keyPrefix: 'XX' }))).toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it('PRJ-03/04 (mức U): keyPrefix trùng trong ws ⇒ 409 field keyPrefix; trùng ở ws khác ⇒ được', async () => {
    await h.project(ctx.B, 'WEB');
    await create().execute(ctx.pam, { name: 'A', keyPrefix: 'WEB' });
    const err = await caught(create().execute(ctx.pam, { name: 'B', keyPrefix: 'WEB' }));
    expect(err).toBeInstanceOf(ResourceConflictError);
    expect((err as ResourceConflictError).details).toMatchObject({ field: 'keyPrefix' });
  });

  it('PRJ-05: keyPrefix sai ⇒ 400', async () => {
    for (const keyPrefix of ['web', '1AB', 'A', 'ABCDEFGHIJK']) {
      expect(await caught(create().execute(ctx.pam, { name: 'X', keyPrefix }))).toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it('PRJ-06: workspaceId trong input bị bỏ qua — tenant chỉ từ actor', async () => {
    const view = await create().execute(ctx.pam, {
      name: 'X',
      keyPrefix: 'XX',
      workspaceId: ctx.B,
    } as never);
    expect(view.workspaceId).toBe(ctx.A);
  });
});

describe('UpdateProjectUseCase', () => {
  const update = () => new UpdateProjectUseCase(h);

  it('PRU-01: PM đổi tên/mô tả', async () => {
    const p = await h.project(ctx.A, 'WEB');
    expect(
      await update().execute(ctx.pam, { projectId: p, name: 'Site', description: 'Mô tả' }),
    ).toMatchObject({ name: 'Site', description: 'Mô tả' });
  });

  it('PRU-02: có keyPrefix ⇒ bị bỏ qua (bất biến); không field nào ⇒ 400', async () => {
    const p = await h.project(ctx.A, 'WEB');
    expect(
      await update().execute(ctx.pam, { projectId: p, name: 'S', keyPrefix: 'NEW' } as never),
    ).toMatchObject({ keyPrefix: 'WEB' });
    expect(await caught(update().execute(ctx.pam, { projectId: p }))).toBeInstanceOf(
      ValidationError,
    );
  });

  it('PRU-03: project archived ⇒ 422 PROJECT_ARCHIVED', async () => {
    const p = await h.project(ctx.A, 'OLD', true);
    expect(await caught(update().execute(ctx.pam, { projectId: p, name: 'X' }))).toBeInstanceOf(
      ProjectArchivedError,
    );
  });

  it('PRU-04: MEMBER sửa project archived ⇒ 403 (403 trước 422)', async () => {
    const p = await h.project(ctx.A, 'OLD', true);
    expect(await caught(update().execute(ctx.mia, { projectId: p, name: 'X' }))).toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('PRU-05 (mức U): project của ws khác ⇒ 404 project', async () => {
    const p = await h.project(ctx.B, 'BRV');
    const err = await caught(update().execute(ctx.pam, { projectId: p, name: 'X' }));
    expect((err as ResourceNotFoundError).details).toEqual({ resource: 'project' });
  });
});

describe('SetProjectArchivedUseCase', () => {
  const set = () => new SetProjectArchivedUseCase(h);

  it('ARC-01/02: archive ⇒ archivedAt = now; archive lại giữ nguyên archivedAt', async () => {
    const p = await h.project(ctx.A, 'WEB');
    const first = await set().execute(ctx.pam, { projectId: p, archived: true });
    expect(first).toMatchObject({ isArchived: true, archivedAt: h.clock.now() });
    h.clock.advance(60_000);
    expect((await set().execute(ctx.pam, { projectId: p, archived: true })).archivedAt).toEqual(
      first.archivedAt,
    );
  });

  it('ARC-03: MEMBER / VIEWER ⇒ 403', async () => {
    const p = await h.project(ctx.A, 'WEB');
    for (const actor of [ctx.mia, ctx.vic]) {
      expect(await caught(set().execute(actor, { projectId: p, archived: true }))).toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it('ARC-04 (mức U): project ws khác ⇒ 404', async () => {
    const p = await h.project(ctx.B, 'BRV');
    expect(await caught(set().execute(ctx.pam, { projectId: p, archived: true }))).toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it('ARC-05: unarchive idempotent', async () => {
    const p = await h.project(ctx.A, 'OLD', true);
    expect(await set().execute(ctx.pam, { projectId: p, archived: false })).toMatchObject({
      isArchived: false,
      archivedAt: null,
    });
    expect(await set().execute(ctx.pam, { projectId: p, archived: false })).toMatchObject({
      isArchived: false,
    });
  });
});

describe('ListProjectsQuery / GetProjectQuery', () => {
  it('VIEWER đọc được; lọc archived false/true/all (mặc định false)', async () => {
    await h.project(ctx.A, 'WEB');
    h.clock.advance(1000); // sắp theo createdAt (uuid v7 ở prod cũng tăng theo thời gian)
    await h.project(ctx.A, 'OLD', true);
    await h.project(ctx.B, 'BRV');
    const list = new ListProjectsQuery(h);
    expect((await list.execute(ctx.vic, {})).items.map((p) => p.keyPrefix)).toEqual(['WEB']);
    expect(
      (await list.execute(ctx.vic, { archived: 'true' })).items.map((p) => p.keyPrefix),
    ).toEqual(['OLD']);
    expect(
      (await list.execute(ctx.vic, { archived: 'all' })).items.map((p) => p.keyPrefix),
    ).toEqual(['WEB', 'OLD']);
  });

  it('GET project: đúng ws ⇒ trả; ws khác ⇒ 404', async () => {
    const mine = await h.project(ctx.A, 'WEB');
    const other = await h.project(ctx.B, 'BRV');
    const get = new GetProjectQuery(h);
    expect(await get.execute(ctx.vic, { projectId: mine })).toMatchObject({ keyPrefix: 'WEB' });
    expect(await caught(get.execute(ctx.vic, { projectId: other }))).toBeInstanceOf(
      ResourceNotFoundError,
    );
  });
});
