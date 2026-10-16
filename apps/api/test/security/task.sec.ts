import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { Actors, seedTasks, seedTenants, type Actor, type Role } from './harness/actors';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { secCase, useApi } from './harness/suite';

// Task: IDOR, RBAC/Policy, archived, VERSION_CONFLICT, bỏ gán khi hạ VIEWER (security.md §8,
// data-and-api §2.7). Case CÓ ghi dữ liệu tự tạo task/project/member riêng — không làm bẩn fixture
// dùng chung (pamTask/miaTask) mà các case chỉ-đọc dựa vào.

const api = useApi();
const actors = new Actors(api);
const TASK = 'task routes (Phase 3)';

let seeded: ReturnType<typeof seedTasks> | undefined;
const fixture = async () => (seeded ??= seedTasks(actors, await seedTenants(actors)));

interface TaskDto {
  id: string;
  version: number;
  title: string;
  status: string;
  assignee: { id: string } | null;
  createdBy: { id: string } | null;
}

const tasksPath = (wsId: string, projectId: string) =>
  `/workspaces/${wsId}/projects/${projectId}/tasks`;
const dataOf = <T>(res: RawResponse) => (res.json as { data: T }).data;
const prefix = () =>
  `P${Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')}`;

async function newTask(actor: Actor, wsId: string, projectId: string, body: object = {}) {
  const res = await actors.json('POST', tasksPath(wsId, projectId), actor.accessToken, {
    title: `sec ${randomUUID().slice(0, 8)}`,
    ...body,
  });
  expect(res.status, `tạo task: ${res.text.slice(0, 200)}`).toBe(201);
  return dataOf<TaskDto>(res);
}

async function newMember(owner: Actor, wsId: string, role: Role) {
  const member = await actors.register(`m-${role.toLowerCase()}`);
  await actors.addMember(owner, wsId, member, role);
  return member;
}

describe('IDOR task', () => {
  secCase('SEC-02', 'URL ws B + project/task của A ⇒ 404, DB không đổi', TASK, async () => {
    const t = await fixture();
    const base = tasksPath(t.wsB, t.projectA.id);
    const attempts = await Promise.all([
      actors.json('GET', base, t.bob.accessToken),
      actors.json('GET', `${base}/${t.pamTask.id}`, t.bob.accessToken),
      actors.json('POST', base, t.bob.accessToken, { title: 'chen ngang' }),
      actors.json('PATCH', `${base}/${t.pamTask.id}`, t.bob.accessToken, {
        expectedVersion: t.pamTask.version,
        title: 'hacked',
      }),
      actors.json('DELETE', `${base}/${t.pamTask.id}`, t.bob.accessToken),
      actors.json('GET', `${base}/${t.pamTask.id}/audit-logs`, t.bob.accessToken),
    ]);
    for (const res of attempts) expect(res.status).toBe(404);
    // Bob dùng đúng URL của ws A (không phải member) cũng 404.
    const direct = await actors.json(
      'GET',
      `${tasksPath(t.wsA, t.projectA.id)}/${t.pamTask.id}`,
      t.bob.accessToken,
    );
    expect(direct.status).toBe(404);
    const after = await actors.json(
      'GET',
      `${tasksPath(t.wsA, t.projectA.id)}/${t.pamTask.id}`,
      t.alice.accessToken,
    );
    expect(dataOf<TaskDto>(after)).toMatchObject({
      title: 'task của Pam',
      version: t.pamTask.version,
    });
  });

  secCase(
    'SEC-03',
    'taskId của project khác (cùng ws) dưới URL project hiện tại ⇒ 404',
    TASK,
    async () => {
      const t = await fixture();
      const other = await actors.createProject(t.alice, t.wsA, prefix());
      const foreign = await newTask(t.mia, t.wsA, other.id);
      const wrong = `${tasksPath(t.wsA, t.projectA.id)}/${foreign.id}`;
      const results = await Promise.all([
        actors.json('GET', wrong, t.mia.accessToken),
        actors.json('PATCH', wrong, t.mia.accessToken, {
          expectedVersion: foreign.version,
          title: 'xyz',
        }),
        actors.json('PATCH', `${wrong}/move`, t.mia.accessToken, {
          expectedVersion: foreign.version,
          status: 'IN_PROGRESS',
        }),
        actors.json('DELETE', wrong, t.mia.accessToken),
      ]);
      for (const res of results) expect(res.status).toBe(404);
    },
  );

  secCase(
    'TASK-LIST',
    'Danh sách task của project A không chứa task của ws B; assigneeId lạ không lộ gì',
    TASK,
    async () => {
      const t = await fixture();
      const list = await actors.json(
        'GET',
        `${tasksPath(t.wsA, t.projectA.id)}?assigneeId=${t.bob.userId}`,
        t.alice.accessToken,
      );
      expect(list.status).toBe(200);
      expect(dataOf<TaskDto[]>(list)).toEqual([]);
      const all = dataOf<TaskDto[]>(
        await actors.json('GET', tasksPath(t.wsA, t.projectA.id), t.alice.accessToken),
      );
      expect(all.map((x) => x.id)).not.toContain(t.bobTask.id);
    },
  );
});

describe('Mass assignment task', () => {
  secCase('SEC-04', 'Field lạ khi tạo/sửa task ⇒ 400, không ghi', TASK, async () => {
    const t = await fixture();
    const base = tasksPath(t.wsA, t.projectA.id);
    const create = await actors.json('POST', base, t.mia.accessToken, {
      title: 'xyz',
      workspaceId: t.wsB,
      createdById: t.alice.userId,
      version: 99,
    });
    expect(create.status).toBe(400);
    expect(errorEnvelope(create).error.code).toBe('VALIDATION_ERROR');
    const own = await newTask(t.mia, t.wsA, t.projectA.id);
    for (const extra of [
      { createdById: t.alice.userId },
      { projectId: t.projectB.id },
      { rank: 'a' },
    ]) {
      const patch = await actors.json('PATCH', `${base}/${own.id}`, t.mia.accessToken, {
        expectedVersion: own.version,
        title: 'yyy',
        ...extra,
      });
      expect(patch.status, JSON.stringify(extra)).toBe(400);
    }
    const after = dataOf<TaskDto>(await actors.json('GET', `${base}/${own.id}`, t.mia.accessToken));
    expect(after).toMatchObject({ version: own.version, createdBy: { id: t.mia.userId } });
  });
});

describe('RBAC & Policy', () => {
  secCase('SEC-05', 'VIEWER tạo/sửa/move/assign/xóa ⇒ 403 cả 5', TASK, async () => {
    const t = await fixture();
    const base = tasksPath(t.wsA, t.projectA.id);
    const v = t.pamTask.version;
    const results = await Promise.all([
      actors.json('POST', base, t.vic.accessToken, { title: 'xyz' }),
      actors.json('PATCH', `${base}/${t.pamTask.id}`, t.vic.accessToken, {
        expectedVersion: v,
        title: 'xyz',
      }),
      actors.json('PATCH', `${base}/${t.pamTask.id}/move`, t.vic.accessToken, {
        expectedVersion: v,
        status: 'IN_PROGRESS',
      }),
      actors.json('PATCH', `${base}/${t.pamTask.id}/assignee`, t.vic.accessToken, {
        expectedVersion: v,
        assigneeId: t.vic.userId,
      }),
      actors.json('DELETE', `${base}/${t.pamTask.id}`, t.vic.accessToken),
    ]);
    for (const res of results) {
      expect(res.status).toBe(403);
      expect(errorEnvelope(res).error.code).toBe('FORBIDDEN_ACCESS');
    }
  });

  secCase('SEC-06', 'MEMBER xóa task do PM tạo ⇒ 403, task còn nguyên', TASK, async () => {
    const t = await fixture();
    const base = tasksPath(t.wsA, t.projectA.id);
    const res = await actors.json('DELETE', `${base}/${t.pamTask.id}`, t.mia.accessToken);
    expect(res.status).toBe(403);
    expect((await actors.json('GET', `${base}/${t.pamTask.id}`, t.alice.accessToken)).status).toBe(
      200,
    );
  });

  secCase('SEC-07', 'MEMBER xóa task của chính mình ⇒ 200 { id, version }', TASK, async () => {
    const t = await fixture();
    const base = tasksPath(t.wsA, t.projectA.id);
    const own = await newTask(t.mia, t.wsA, t.projectA.id);
    const res = await actors.json('DELETE', `${base}/${own.id}`, t.mia.accessToken);
    expect(res.status).toBe(200);
    expect(Object.keys(dataOf<object>(res)).sort()).toEqual(['id', 'version']);
    expect(dataOf<TaskDto>(res).id).toBe(own.id);
    expect((await actors.json('GET', `${base}/${own.id}`, t.mia.accessToken)).status).toBe(404);
  });

  secCase('SEC-08', 'PM xóa task của MEMBER; OWNER xóa task bất kỳ ⇒ 200', TASK, async () => {
    const t = await fixture();
    const base = tasksPath(t.wsA, t.projectA.id);
    const miaTask = await newTask(t.mia, t.wsA, t.projectA.id);
    const pamTask = await newTask(t.pam, t.wsA, t.projectA.id);
    expect((await actors.json('DELETE', `${base}/${miaTask.id}`, t.pam.accessToken)).status).toBe(
      200,
    );
    expect((await actors.json('DELETE', `${base}/${pamTask.id}`, t.alice.accessToken)).status).toBe(
      200,
    );
  });

  secCase(
    'SEC-09',
    'Task createdById = null: MEMBER 403 / PM 200 (cần xóa user tạo task — chưa có API)',
    TASK,
  );

  secCase(
    'SEC-10',
    'Project archived: tạo/sửa/move/xóa ⇒ 422 PROJECT_ARCHIVED; VIEWER ⇒ 403 (thứ tự kiểm tra)',
    TASK,
    async () => {
      const t = await fixture();
      const project = await actors.createProject(t.alice, t.wsA, prefix());
      const base = tasksPath(t.wsA, project.id);
      const miaTask = await newTask(t.mia, t.wsA, project.id);
      const pamTask = await newTask(t.pam, t.wsA, project.id);
      const archive = await actors.json(
        'POST',
        `/workspaces/${t.wsA}/projects/${project.id}/archive`,
        t.alice.accessToken,
      );
      expect(archive.status).toBe(200);
      const v = miaTask.version;
      const writes = await Promise.all([
        actors.json('POST', base, t.mia.accessToken, { title: 'xyz' }),
        actors.json('PATCH', `${base}/${miaTask.id}`, t.mia.accessToken, {
          expectedVersion: v,
          title: 'xyz',
        }),
        actors.json('PATCH', `${base}/${miaTask.id}/move`, t.mia.accessToken, {
          expectedVersion: v,
          status: 'IN_PROGRESS',
        }),
        actors.json('DELETE', `${base}/${miaTask.id}`, t.mia.accessToken),
        actors.json('DELETE', `${base}/${pamTask.id}`, t.pam.accessToken),
      ]);
      for (const res of writes) {
        expect(res.status, res.text.slice(0, 200)).toBe(422);
        expect(errorEnvelope(res).error.code).toBe('PROJECT_ARCHIVED');
      }
      const viewer = await Promise.all([
        actors.json('POST', base, t.vic.accessToken, { title: 'xyz' }),
        actors.json('PATCH', `${base}/${miaTask.id}`, t.vic.accessToken, {
          expectedVersion: v,
          title: 'xyz',
        }),
      ]);
      for (const res of viewer) expect(res.status).toBe(403);
    },
  );

  secCase(
    'SEC-11',
    'MEMBER gán task cho người ngoài ws ⇒ 422, lỗi giống hệt uuid không tồn tại',
    TASK,
    async () => {
      const t = await fixture();
      const own = await newTask(t.mia, t.wsA, t.projectA.id);
      const assign = (assigneeId: string) =>
        actors.json(
          'PATCH',
          `${tasksPath(t.wsA, t.projectA.id)}/${own.id}/assignee`,
          t.mia.accessToken,
          { expectedVersion: own.version, assigneeId },
        );
      const outsider = await assign(t.bob.userId);
      const ghost = await assign(randomUUID());
      expect(outsider.status).toBe(422);
      expect(errorEnvelope(outsider).error).toEqual(errorEnvelope(ghost).error);
      expect(outsider.text).not.toContain(t.bob.userId);
    },
  );

  secCase('SEC-12', 'MEMBER đổi assignee task do PM tạo ⇒ 403', TASK, async () => {
    const t = await fixture();
    const res = await actors.json(
      'PATCH',
      `${tasksPath(t.wsA, t.projectA.id)}/${t.pamTask.id}/assignee`,
      t.mia.accessToken,
      { expectedVersion: t.pamTask.version, assigneeId: t.vic.userId },
    );
    expect(res.status).toBe(403);
  });

  secCase(
    'SEC-12b',
    'MEMBER tạo task gán người khác / gán chính mình ⇒ 403 / 201',
    TASK,
    async () => {
      const t = await fixture();
      const other = await newMember(t.alice, t.wsA, 'MEMBER');
      const base = tasksPath(t.wsA, t.projectA.id);
      const toOther = await actors.json('POST', base, t.mia.accessToken, {
        title: 'gán người khác',
        assigneeId: other.userId,
      });
      expect(toOther.status).toBe(403);
      const toSelf = await actors.json('POST', base, t.mia.accessToken, {
        title: 'tự gán',
        assigneeId: t.mia.userId,
      });
      expect(toSelf.status).toBe(201);
      expect(dataOf<TaskDto>(toSelf).assignee?.id).toBe(t.mia.userId);
    },
  );

  secCase('SEC-12c', 'PM tạo task gán người ngoài ws ⇒ 422, không tạo task', TASK, async () => {
    const t = await fixture();
    const base = tasksPath(t.wsA, t.projectA.id);
    const marker = `ghost-${randomUUID()}`;
    const res = await actors.json('POST', base, t.pam.accessToken, {
      title: marker,
      assigneeId: t.bob.userId,
    });
    expect(res.status).toBe(422);
    const all = dataOf<TaskDto[]>(await actors.json('GET', base, t.alice.accessToken));
    expect(all.map((x) => x.title)).not.toContain(marker);
  });

  secCase(
    'SEC-42',
    'VIEWER PATCH với version cũ ⇒ 403 (không 409, không lộ details.current)',
    TASK,
    async () => {
      const t = await fixture();
      const res = await actors.json(
        'PATCH',
        `${tasksPath(t.wsA, t.projectA.id)}/${t.pamTask.id}`,
        t.vic.accessToken,
        { expectedVersion: t.pamTask.version + 99, title: 'xyz' },
      );
      expect(res.status).toBe(403);
      expect(res.text).not.toContain('currentVersion');
      expect(res.text).not.toContain('task của Pam');
    },
  );

  secCase(
    'SEC-43',
    'PM gán VIEWER (khi tạo + PATCH assignee) ⇒ 422 ASSIGNEE_NOT_MEMBER, cùng lỗi với người ngoài ws',
    TASK,
    async () => {
      const t = await fixture();
      const base = tasksPath(t.wsA, t.projectA.id);
      const onCreate = await actors.json('POST', base, t.pam.accessToken, {
        title: 'gán viewer',
        assigneeId: t.vic.userId,
      });
      const own = await newTask(t.pam, t.wsA, t.projectA.id);
      const onPatch = await actors.json('PATCH', `${base}/${own.id}/assignee`, t.pam.accessToken, {
        expectedVersion: own.version,
        assigneeId: t.vic.userId,
      });
      const outsider = await actors.json('PATCH', `${base}/${own.id}/assignee`, t.pam.accessToken, {
        expectedVersion: own.version,
        assigneeId: t.bob.userId,
      });
      for (const res of [onCreate, onPatch]) {
        expect(res.status).toBe(422);
        expect(errorEnvelope(res).error.details).toMatchObject({ rule: 'ASSIGNEE_NOT_MEMBER' });
        expect(errorEnvelope(res).error).toEqual(errorEnvelope(outsider).error);
      }
    },
  );
});

describe('Optimistic locking (ADR-010/091)', () => {
  secCase(
    'TASK-VC',
    'PATCH version cũ ⇒ 409 VERSION_CONFLICT + currentVersion; no-op với version cũ vẫn 409',
    TASK,
    async () => {
      const t = await fixture();
      const base = tasksPath(t.wsA, t.projectA.id);
      const own = await newTask(t.mia, t.wsA, t.projectA.id);
      const first = await actors.json('PATCH', `${base}/${own.id}`, t.mia.accessToken, {
        expectedVersion: own.version,
        title: 'lần 1',
      });
      expect(first.status).toBe(200);
      const v2 = dataOf<TaskDto>(first).version;
      expect(v2).toBe(own.version + 1);
      for (const title of ['lần 2', 'lần 1']) {
        const stale = await actors.json('PATCH', `${base}/${own.id}`, t.mia.accessToken, {
          expectedVersion: own.version,
          title,
        });
        expect(stale.status, `title=${title}`).toBe(409);
        expect(errorEnvelope(stale).error.code).toBe('VERSION_CONFLICT');
        expect(errorEnvelope(stale).error.details).toMatchObject({ currentVersion: v2 });
      }
      const staleDelete = await actors.json(
        'DELETE',
        `${base}/${own.id}?expectedVersion=${own.version}`,
        t.mia.accessToken,
      );
      expect(staleDelete.status).toBe(409);
    },
  );

  secCase(
    'TASK-VC-RACE',
    '10 PATCH song song cùng expectedVersion ⇒ đúng 1 cái 200, còn lại 409',
    TASK,
    async () => {
      const t = await fixture();
      const base = tasksPath(t.wsA, t.projectA.id);
      const own = await newTask(t.mia, t.wsA, t.projectA.id);
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          actors.json('PATCH', `${base}/${own.id}`, t.mia.accessToken, {
            expectedVersion: own.version,
            title: `song song ${i}`,
          }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, ...Array<number>(9).fill(409)]);
    },
  );
});

describe('Bỏ gán khi mất quyền (ADR-044)', () => {
  secCase(
    'SEC-44',
    'Hạ member xuống VIEWER ⇒ task chưa xóa bị bỏ gán (version+1), task đã xóa giữ nguyên',
    TASK,
    async () => {
      const t = await fixture();
      const base = tasksPath(t.wsA, t.projectA.id);
      const member = await newMember(t.alice, t.wsA, 'MEMBER');
      const [a, b, c] = await Promise.all(
        [1, 2, 3].map(() => newTask(t.pam, t.wsA, t.projectA.id, { assigneeId: member.userId })),
      );
      if (!a || !b || !c) throw new Error('tạo task thất bại');
      expect((await actors.json('DELETE', `${base}/${c.id}`, t.pam.accessToken)).status).toBe(200);
      const demote = await actors.json(
        'PATCH',
        `/workspaces/${t.wsA}/members/${member.userId}`,
        t.alice.accessToken,
        { role: 'VIEWER' },
      );
      expect(demote.status).toBe(200);
      expect(dataOf<{ unassignedTaskCount: number }>(demote).unassignedTaskCount).toBe(2);
      for (const task of [a, b]) {
        const now = dataOf<TaskDto>(
          await actors.json('GET', `${base}/${task.id}`, t.alice.accessToken),
        );
        expect(now.assignee).toBeNull();
        expect(now.version).toBe(task.version + 1);
      }
      const audit = await actors.json('GET', `${base}/${a.id}/audit-logs`, t.alice.accessToken);
      expect(audit.status).toBe(200);
      expect(JSON.stringify(audit.json)).toContain(t.alice.userId);
    },
  );

  secCase(
    'SEC-45',
    'Race gán task cho member ‖ hạ member xuống VIEWER (20 vòng) ⇒ không bao giờ VIEWER được gán',
    TASK,
    async () => {
      const t = await fixture();
      const base = tasksPath(t.wsA, t.projectA.id);
      for (let round = 0; round < 20; round += 1) {
        const member = await newMember(t.alice, t.wsA, 'MEMBER');
        const task = await newTask(t.pam, t.wsA, t.projectA.id);
        await Promise.all([
          actors.json('PATCH', `${base}/${task.id}/assignee`, t.pam.accessToken, {
            expectedVersion: task.version,
            assigneeId: member.userId,
          }),
          actors.json(
            'PATCH',
            `/workspaces/${t.wsA}/members/${member.userId}`,
            t.alice.accessToken,
            {
              role: 'VIEWER',
            },
          ),
        ]);
        const now = dataOf<TaskDto>(
          await actors.json('GET', `${base}/${task.id}`, t.alice.accessToken),
        );
        expect(now.assignee, `vòng ${round}`).toBeNull();
      }
    },
  );
});
