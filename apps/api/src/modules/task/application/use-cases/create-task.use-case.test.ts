import { describe, expect, it, vi } from 'vitest';

import { requestContext } from '../../../../core/context/request-context';
import {
  BusinessRuleViolationError,
  ForbiddenError,
  ProjectArchivedError,
  ResourceConflictError,
  ResourceNotFoundError,
} from '../../../../core/errors';
import { RankConflictError } from '../ports/task-repository.port';
import { createTaskHarness, P1, P2, Q1, U } from '../../testing/task-harness';

// test-spec-task.md §3.1 (tầng A).
describe('CreateTaskUseCase', () => {
  it('UC-CR01: task đầu tiên TF-1, mặc định TODO/MEDIUM/v1; nextTaskNumber tăng', async () => {
    const h = await createTaskHarness();
    const dto = await h.create.execute({ ...h.scope('Mia'), input: { title: 'Đầu tiên' } });
    expect(dto).toMatchObject({
      number: 1,
      key: 'TF-1',
      status: 'TODO',
      priority: 'MEDIUM',
      version: 1,
      createdBy: { id: U.Mia, fullName: 'Mia' },
      assignee: null,
    });
    expect((await h.project(P1)).nextTaskNumber).toBe(2);
  });

  it('UC-CR02: rank mới = cuối cột TODO, bỏ qua cột khác', async () => {
    const h = await createTaskHarness();
    await h.seedTask({ rank: 'a0' });
    await h.seedTask({ rank: 'a1' });
    await h.seedTask({ rank: 'a9', status: 'IN_PROGRESS' });
    const dto = await h.create.execute({ ...h.scope('Mia'), input: { title: 'Mới' } });
    expect(dto.rank).toBe('a2');
  });

  it('UC-CR03: đúng 1 audit CREATED với newValue đủ khóa + requestId', async () => {
    const h = await createTaskHarness();
    const dto = await requestContext.run({ requestId: 'req-42' }, () =>
      h.create.execute({ ...h.scope('Mia'), input: { title: 'Có audit', dueDate: '2026-12-01' } }),
    );
    const rows = await h.auditOf(dto.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'CREATED',
      actorId: U.Mia,
      workspaceId: dto.workspaceId,
      projectId: P1,
      requestId: 'req-42',
      oldValue: null,
      newValue: {
        number: 1,
        title: 'Có audit',
        status: 'TODO',
        priority: 'MEDIUM',
        rank: dto.rank,
        dueDate: '2026-12-01',
        assigneeId: null,
      },
    });
  });

  it('UC-CR04: sau commit — 1 TaskCreated trên bus, realtime task:created mang DTO + originClientId', async () => {
    const h = await createTaskHarness();
    const dto = await h.create.execute({
      ...h.scope('Mia', P1, { clientId: 'c-1' }),
      input: { title: 'Realtime' },
    });
    expect(h.events.types()).toEqual(['TaskCreated']);
    const [call] = h.emitted();
    expect(call?.duringTransaction).toBe(false);
    expect(call?.args).toEqual([
      { projectId: P1, type: 'task:created', data: { task: dto } },
      { actorId: U.Mia, originClientId: 'c-1' },
    ]);
  });

  it('UC-CR05: audit lỗi ⇒ rollback: không task, không đốt số, không event', async () => {
    const h = await createTaskHarness();
    h.deps.audit.append = () => Promise.reject(new Error('audit down'));
    await expect(h.create.execute({ ...h.scope('Mia'), input: { title: 'Hỏng' } })).rejects.toThrow(
      'audit down',
    );
    expect(await h.taskCount()).toBe(0);
    expect((await h.project(P1)).nextTaskNumber).toBe(1);
    expect(h.events.published).toHaveLength(0);
    expect(h.emitted()).toHaveLength(0);
  });

  it('UC-CR06: event bus lỗi ⇒ vẫn trả task, lỗi được log', async () => {
    const h = await createTaskHarness();
    h.events.publish = () => Promise.reject(new Error('bus down'));
    const dto = await h.create.execute({ ...h.scope('Mia'), input: { title: 'Vẫn ổn' } });
    expect(dto.number).toBe(1);
    expect(h.logger.messages('error')).toContain('task.events_publish_failed');
  });

  it('UC-CR07: project archived ⇒ 422, không đốt số', async () => {
    const h = await createTaskHarness();
    await expect(
      h.create.execute({ ...h.scope('Mia', P2), input: { title: 'Không được' } }),
    ).rejects.toBeInstanceOf(ProjectArchivedError);
    expect((await h.project(P2)).nextTaskNumber).toBe(1);
  });

  it('UC-CR08/CR09: VIEWER ⇒ 403 (403 đứng trước 422 archived)', async () => {
    const h = await createTaskHarness();
    for (const project of [P2, P1]) {
      await expect(
        h.create.execute({ ...h.scope('Vic', project), input: { title: 'Viewer' } }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('UC-CR10: project của workspace khác ⇒ 404', async () => {
    const h = await createTaskHarness();
    await expect(
      h.create.execute({ ...h.scope('Mia', Q1), input: { title: 'Lạc ws' } }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('UC-CR11/CR12: MEMBER tự gán mình được; gán người khác ⇒ 403', async () => {
    const h = await createTaskHarness();
    const dto = await h.create.execute({
      ...h.scope('Mia'),
      input: { title: 'Của tôi', assigneeId: U.Mia },
    });
    expect(dto.assignee).toEqual({ id: U.Mia, fullName: 'Mia' });
    await expect(
      h.create.execute({ ...h.scope('Mia'), input: { title: 'Cho Max', assigneeId: U.Max } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each([
    ['UC-CR13', 'Vic'],
    ['UC-CR14', 'Otto'],
    ['UC-CR15', 'Zed'],
  ] as const)('%s: PM gán cho %s ⇒ 422 ASSIGNEE_NOT_MEMBER, không tạo task', async (_, who) => {
    const h = await createTaskHarness();
    const err = await h.create
      .execute({ ...h.scope('Pam'), input: { title: 'Sai người', assigneeId: U[who] } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleViolationError);
    expect((err as BusinessRuleViolationError).details).toMatchObject({
      rule: 'ASSIGNEE_NOT_MEMBER',
    });
    expect(await h.taskCount()).toBe(0);
  });

  it('project bị archive giữa lúc đọc và lúc cấp số ⇒ 422 (không 500)', async () => {
    const h = await createTaskHarness();
    const original = h.deps.projects.allocateTaskNumber.bind(h.deps.projects);
    h.deps.projects.allocateTaskNumber = async (key) => {
      await h.backend.patchProject(key.projectId, { archivedAt: new Date() });
      return original(key);
    };
    await expect(
      h.create.execute({ ...h.scope('Mia'), input: { title: 'Đua' } }),
    ).rejects.toBeInstanceOf(ProjectArchivedError);
  });

  it('trùng rank (unique partial) ⇒ thử lại cả transaction, quá 3 lần ⇒ 409 RESOURCE_CONFLICT', async () => {
    const h = await createTaskHarness();
    let attempts = 0;
    h.deps.tasks.add = () => {
      attempts += 1;
      return Promise.reject(new RankConflictError());
    };
    await expect(
      h.create.execute({ ...h.scope('Mia'), input: { title: 'Đụng rank' } }),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    expect(attempts).toBe(3);
    expect(h.uow.rollbacks).toBe(3);
    expect((await h.project(P1)).nextTaskNumber).toBe(1);
  });
});

// F3 (mutation, report §4.2) — biên của create mà mutant còn sống.
describe('CreateTaskUseCase — biên (F3 mutation)', () => {
  it('T-2: khóa ĐÚNG cột TODO trước khi đọc rank cuối (ADR-116 — không đọc khóa tạm `~<id>` của rebalance)', async () => {
    const h = await createTaskHarness();
    const lockColumn = vi.spyOn(h.deps.tasks, 'lockColumn');
    const lastRank = vi.spyOn(h.deps.tasks, 'lastRank');
    await h.create.execute({ ...h.scope('Mia'), input: { title: 'Có khóa' } });
    expect(lockColumn).toHaveBeenCalledWith(P1, 'TODO');
    // Khóa phải lấy TRƯỚC khi đọc hàng xóm.
    expect(lockColumn.mock.invocationCallOrder[0]!).toBeLessThan(
      lastRank.mock.invocationCallOrder[0]!,
    );
  });

  it('T-10: description + priority khác mặc định được lưu', async () => {
    const h = await createTaskHarness();
    const dto = await h.create.execute({
      ...h.scope('Mia'),
      input: { title: 'abc', description: 'Mô tả', priority: 'HIGH' },
    });
    expect(dto).toMatchObject({ description: 'Mô tả', priority: 'HIGH' });
  });

  it('T-11: MEMBER gửi `assigneeId: null` (không gán) ⇒ tạo được', async () => {
    const h = await createTaskHarness();
    const dto = await h.create.execute({
      ...h.scope('Mia'),
      input: { title: 'Không gán', assigneeId: null },
    });
    expect(dto.assignee).toBeNull();
  });

  it('T-22: 403 mang đúng quyền thiếu (`details.required`)', async () => {
    const h = await createTaskHarness();
    await expect(
      h.create.execute({ ...h.scope('Vic'), input: { title: 'x' } }),
    ).rejects.toMatchObject({ statusCode: 403, details: { required: 'task:create' } });
    await expect(
      h.create.execute({ ...h.scope('Mia'), input: { title: 'x', assigneeId: U.Max } }),
    ).rejects.toMatchObject({ statusCode: 403, details: { required: 'task:assign:any' } });
  });

  it('T-23: project của workspace khác ⇒ 404 `details.resource = project`', async () => {
    const h = await createTaskHarness();
    await expect(
      h.create.execute({ ...h.scope('Mia', Q1), input: { title: 'x' } }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'project' } });
  });

  it('T-24: project archived + assignee không phải thành viên ⇒ PROJECT_ARCHIVED (422 đứng trước kiểm assignee)', async () => {
    const h = await createTaskHarness();
    await expect(
      h.create.execute({ ...h.scope('Pam', P2), input: { title: 'x', assigneeId: U.Otto } }),
    ).rejects.toBeInstanceOf(ProjectArchivedError);
  });
});
