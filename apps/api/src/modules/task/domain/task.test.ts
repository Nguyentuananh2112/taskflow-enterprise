import { describe, expect, it } from 'vitest';

import {
  InvalidStatusTransitionError,
  ValidationError,
  VersionConflictError,
} from '../../../core/errors';
import { Rank } from './rank';
import { Task, type CreateTaskProps, type TaskProps } from './task';
import { TaskAlreadyDeletedError } from './task-errors';
import type { TaskStatus } from './task-status';

// test-spec-task.md §1 (tầng U). Mã case trong tên test để truy vết.
const NOW = new Date('2026-10-15T08:00:00.000Z');
const LATER = new Date('2026-10-15T09:00:00.000Z');
const [MIA, MAX, PAM] = ['u-mia', 'u-max', 'u-pam'];

const createProps = (over: Partial<CreateTaskProps> = {}): CreateTaskProps => ({
  id: 't-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  number: 1,
  title: 'Viết spec',
  rank: 'a0',
  createdById: MIA,
  now: NOW,
  ...over,
});

const taskFactory = (over: Partial<TaskProps> = {}): Task =>
  Task.reconstitute({
    id: 't-1',
    workspaceId: 'w-1',
    projectId: 'p-1',
    number: 3,
    title: 'Viết spec',
    description: 'Mô tả',
    status: 'TODO',
    priority: 'MEDIUM',
    rank: 'a0',
    version: 3,
    dueDate: '2026-11-01',
    assigneeId: null,
    createdById: MIA,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

describe('Task.create (§1.1)', () => {
  it('TE-C01: mặc định TODO, v1, MEDIUM, title đã trim', () => {
    const t = Task.create(createProps({ title: '  Viết spec  ' })).toPrimitives();
    expect(t).toMatchObject({
      status: 'TODO',
      version: 1,
      title: 'Viết spec',
      priority: 'MEDIUM',
      deletedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('TE-C02: đúng 1 TaskCreated, pull lần 2 ⇒ rỗng', () => {
    const task = Task.create(createProps());
    const events = task.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'TaskCreated',
      aggregateId: 't-1',
      projectId: 'p-1',
      workspaceId: 'w-1',
      actorId: MIA,
      snapshot: { number: 1, title: 'Viết spec', status: 'TODO', rank: 'a0' },
    });
    expect(task.pullDomainEvents()).toEqual([]);
  });

  it('TE-C03/C05/C06: title sai ⇒ ValidationError trên field title', () => {
    for (const title of [' ab ', 'x'.repeat(151), 'a\nbc', 'a\u0007bc']) {
      const err = (() => {
        try {
          Task.create(createProps({ title }));
        } catch (e) {
          return e;
        }
        return undefined;
      })();
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).issues[0]?.path).toEqual(['title']);
    }
  });

  it('TE-C04: title đúng 3 và đúng 150 ký tự', () => {
    expect(() => Task.create(createProps({ title: 'abc' }))).not.toThrow();
    expect(() => Task.create(createProps({ title: 'x'.repeat(150) }))).not.toThrow();
  });

  it('TE-C07/C08: description rỗng ⇒ null; 10 000 ok, 10 001 lỗi', () => {
    expect(Task.create(createProps({ description: '   ' })).toPrimitives().description).toBeNull();
    expect(() => Task.create(createProps({ description: 'x'.repeat(10_000) }))).not.toThrow();
    expect(() => Task.create(createProps({ description: 'x'.repeat(10_001) }))).toThrow(
      ValidationError,
    );
    const multiLine = Task.create(createProps({ description: 'dòng 1\ndòng 2\t' }));
    expect(multiLine.toPrimitives().description).toBe('dòng 1\ndòng 2');
    expect(() => Task.create(createProps({ description: 'a\u0000b' }))).toThrow(ValidationError);
  });

  it('TE-C09/C10: dueDate quá khứ hợp lệ; năm ngoài 2000–2100 hoặc ngày không có thật ⇒ lỗi', () => {
    expect(Task.create(createProps({ dueDate: '2026-01-01' })).toPrimitives().dueDate).toBe(
      '2026-01-01',
    );
    for (const dueDate of ['1999-12-31', '2101-01-01', '2026-02-30', '2026-1-1']) {
      expect(() => Task.create(createProps({ dueDate }))).toThrow(ValidationError);
    }
  });

  it('TE-C11/C12: number ≥ 1, rank không rỗng', () => {
    for (const number of [0, -1, 1.5]) {
      expect(() => Task.create(createProps({ number }))).toThrow(ValidationError);
    }
    expect(() => Task.create(createProps({ rank: '' }))).toThrow(ValidationError);
  });

  it('TE-C13: có assignee ⇒ chỉ TaskCreated (chứa assignee), không TaskAssigneeChanged', () => {
    const events = Task.create(createProps({ assigneeId: MAX })).pullDomainEvents();
    expect(events.map((e) => e.type)).toEqual(['TaskCreated']);
    expect(events[0]).toMatchObject({ snapshot: { assigneeId: MAX } });
  });

  it('TE-C14: reconstitute không phát event, giữ đúng props', () => {
    const task = taskFactory({ assigneeId: MAX });
    expect(task.hasPendingDomainEvents).toBe(false);
    expect(task.toPrimitives()).toMatchObject({ assigneeId: MAX, version: 3, number: 3 });
  });
});

const ALL: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
const VALID: [string, TaskStatus, TaskStatus][] = [
  ['TE-M01', 'TODO', 'IN_PROGRESS'],
  ['TE-M02', 'IN_PROGRESS', 'TODO'],
  ['TE-M03', 'IN_PROGRESS', 'REVIEW'],
  ['TE-M04', 'REVIEW', 'IN_PROGRESS'],
  ['TE-M05', 'REVIEW', 'DONE'],
  ['TE-M06', 'DONE', 'REVIEW'],
];
const INVALID: [string, TaskStatus, TaskStatus, TaskStatus[]][] = [
  ['TE-M07', 'TODO', 'REVIEW', ['IN_PROGRESS']],
  ['TE-M08', 'TODO', 'DONE', ['IN_PROGRESS']],
  ['TE-M09', 'IN_PROGRESS', 'DONE', ['TODO', 'REVIEW']],
  ['TE-M10', 'REVIEW', 'TODO', ['IN_PROGRESS', 'DONE']],
  ['TE-M11', 'DONE', 'TODO', ['REVIEW']],
  ['TE-M12', 'DONE', 'IN_PROGRESS', ['REVIEW']],
];

describe('Task.moveTo — 16 cặp trạng thái (§1.2)', () => {
  it.each(VALID)('%s: %s → %s hợp lệ, phát TaskStatusChanged (TE-M20 updatedAt)', (_, from, to) => {
    const task = taskFactory({ status: from });
    expect(task.moveTo(to, Rank.of('a5'), PAM, LATER)).toBe(true);
    expect(task.toPrimitives()).toMatchObject({
      status: to,
      rank: 'a5',
      version: 4,
      updatedAt: LATER,
    });
    expect(task.pullDomainEvents()).toEqual([
      expect.objectContaining({
        type: 'TaskStatusChanged',
        from,
        to,
        fromRank: 'a0',
        toRank: 'a5',
      }),
    ]);
  });

  it.each(INVALID)('%s + TE-M17: %s → %s bị từ chối, entity không đổi', (_, from, to, allowed) => {
    const task = taskFactory({ status: from });
    const before = task.toPrimitives();
    expect(() => task.moveTo(to, Rank.of('a5'), PAM, LATER)).toThrow(
      expect.objectContaining({ details: { from, to, allowed } }) as Error,
    );
    expect(() => task.moveTo(to, Rank.of('a5'), PAM, LATER)).toThrow(InvalidStatusTransitionError);
    expect(task.toPrimitives()).toEqual(before);
    expect(task.pullDomainEvents()).toEqual([]);
  });

  it.each(ALL.map((s, i) => [`TE-M${13 + i}`, s] as const))(
    '%s: %s → cùng cột chỉ đổi rank, phát TaskMoved',
    (_, status) => {
      const task = taskFactory({ status });
      expect(task.moveTo(status, Rank.of('a5'), PAM, LATER)).toBe(true);
      expect(task.version).toBe(4);
      expect(task.pullDomainEvents()).toEqual([
        expect.objectContaining({ type: 'TaskMoved', status, fromRank: 'a0', toRank: 'a5' }),
      ]);
    },
  );

  it('TE-M18: về đúng chỗ cũ ⇒ false, không version, không event', () => {
    const task = taskFactory();
    expect(task.moveTo('TODO', Rank.of('a0'), PAM, LATER)).toBe(false);
    expect(task.version).toBe(3);
    expect(task.hasPendingDomainEvents).toBe(false);
  });
});

describe('Task.assignTo (§1.3)', () => {
  it('TE-A01..A03: đổi assignee ⇒ v+1, event from/to/actor', () => {
    const task = taskFactory({ version: 1 });
    expect(task.assignTo(MAX, PAM, LATER)).toBe(true);
    expect(task.assignTo(MIA, PAM, LATER)).toBe(true);
    expect(task.assignTo(null, PAM, LATER)).toBe(true);
    expect(task.version).toBe(4);
    expect(task.pullDomainEvents()).toEqual([
      expect.objectContaining({ type: 'TaskAssigneeChanged', from: null, to: MAX, actorId: PAM }),
      expect.objectContaining({ from: MAX, to: MIA }),
      expect.objectContaining({ from: MIA, to: null }),
    ]);
  });

  it('TE-A04/A05: gán lại đúng người / bỏ gán task trống ⇒ no-op', () => {
    expect(taskFactory({ assigneeId: MAX }).assignTo(MAX, PAM, LATER)).toBe(false);
    const empty = taskFactory();
    expect(empty.assignTo(null, PAM, LATER)).toBe(false);
    expect(empty.version).toBe(3);
  });
});

describe('Task.update (§1.4)', () => {
  it('TE-U01: đổi title ⇒ TaskUpdated chỉ trường đổi', () => {
    const task = taskFactory({ title: 'A cũ', version: 2 });
    expect(task.update({ title: 'B mới' }, MIA, LATER)).toBe(true);
    expect(task.version).toBe(3);
    expect(task.pullDomainEvents()).toEqual([
      expect.objectContaining({
        type: 'TaskUpdated',
        changedFields: ['title'],
        old: { title: 'A cũ' },
        new: { title: 'B mới' },
      }),
    ]);
  });

  it('TE-U02: một trường sai ⇒ không đổi trường nào (nguyên tử)', () => {
    const task = taskFactory();
    expect(() => task.update({ title: 'x', priority: 'HIGH' }, MIA, LATER)).toThrow(
      ValidationError,
    );
    expect(task.toPrimitives().priority).toBe('MEDIUM');
  });

  it('TE-U03/U07: giá trị y hệt (so sau trim) ⇒ no-op', () => {
    const task = taskFactory();
    expect(task.update({ priority: 'MEDIUM', title: '  Viết spec ' }, MIA, LATER)).toBe(false);
    expect(task.hasPendingDomainEvents).toBe(false);
  });

  it('TE-U04/U05: dueDate null, description rỗng ⇒ null', () => {
    const task = taskFactory();
    task.update({ dueDate: null, description: '  ' }, MIA, LATER);
    expect(task.toPrimitives()).toMatchObject({ dueDate: null, description: null });
    expect(task.pullDomainEvents()[0]).toMatchObject({ changedFields: ['description', 'dueDate'] });
  });

  it('TE-U06: 4 trường đổi ⇒ 1 event, v+1 đúng một lần', () => {
    const task = taskFactory();
    task.update(
      { title: 'Mới hẳn', description: 'Khác', priority: 'HIGH', dueDate: '2027-01-01' },
      MIA,
      LATER,
    );
    expect(task.version).toBe(4);
    const events = task.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      changedFields: ['title', 'description', 'priority', 'dueDate'],
    });
  });

  it('TE-U08: update({}) ⇒ ValidationError', () => {
    expect(() => taskFactory().update({}, MIA, LATER)).toThrow(ValidationError);
  });
});

describe('Task.softDelete (§1.5)', () => {
  it('TE-D01: deletedAt, v+1, TaskDeleted mang version sau xóa', () => {
    const task = taskFactory({ version: 4 });
    task.softDelete(PAM, LATER);
    expect(task.toPrimitives()).toMatchObject({ deletedAt: LATER, version: 5 });
    expect(task.pullDomainEvents()).toEqual([
      expect.objectContaining({
        type: 'TaskDeleted',
        aggregateId: 't-1',
        projectId: 'p-1',
        number: 3,
        version: 5,
        actorId: PAM,
      }),
    ]);
  });

  it('TE-D02/D03: task đã xóa ⇒ mọi lệnh ném TaskAlreadyDeletedError, không đổi gì', () => {
    const task = taskFactory({ deletedAt: NOW });
    const before = task.toPrimitives();
    expect(() => task.softDelete(PAM, LATER)).toThrow(TaskAlreadyDeletedError);
    expect(() => task.update({ title: 'Mới hẳn' }, PAM, LATER)).toThrow(TaskAlreadyDeletedError);
    expect(() => task.moveTo('IN_PROGRESS', Rank.of('a5'), PAM, LATER)).toThrow(
      TaskAlreadyDeletedError,
    );
    expect(() => task.assignTo(MAX, PAM, LATER)).toThrow(TaskAlreadyDeletedError);
    expect(task.toPrimitives()).toEqual(before);
  });
});

describe('version (§1.6)', () => {
  it('TE-V01/V02: assertVersion', () => {
    const task = taskFactory();
    expect(() => task.assertVersion(3)).not.toThrow();
    for (const v of [2, 4]) {
      expect(() => task.assertVersion(v)).toThrow(
        expect.objectContaining({ details: { currentVersion: 3, current: null } }) as Error,
      );
      expect(() => task.assertVersion(v)).toThrow(VersionConflictError);
    }
  });

  it('TE-V03/V04: chỉ thay đổi thật tăng version; event theo thứ tự gọi', () => {
    const task = taskFactory();
    task.update({ title: 'Đổi tên' }, MIA, LATER);
    task.moveTo('IN_PROGRESS', Rank.of('b0'), MIA, LATER);
    task.assignTo(null, MIA, LATER);
    task.assignTo(MAX, MIA, LATER);
    expect(task.version).toBe(6);
    expect(task.pullDomainEvents().map((e) => e.type)).toEqual([
      'TaskUpdated',
      'TaskStatusChanged',
      'TaskAssigneeChanged',
    ]);
  });
});
