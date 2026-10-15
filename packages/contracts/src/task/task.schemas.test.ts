import { describe, expect, it } from 'vitest';

import {
  AssignTaskBody,
  CreateTaskBody,
  DeleteTaskQuery,
  DueDate,
  ListTasksQuery,
  MoveTaskBody,
  TaskDto,
  TaskKey,
  TaskTitle,
  UpdateTaskBody,
  VersionConflictDetails,
} from '../index';
import { ID, sampleTask } from '../__fixtures__/task';

describe('trường task (R1, R2, R4)', () => {
  it('TaskTitle 3–150 sau trim, một dòng', () => {
    expect(TaskTitle.parse('  abc ')).toBe('abc');
    expect(TaskTitle.safeParse(' ab ').success).toBe(false);
    expect(TaskTitle.safeParse('x'.repeat(150)).success).toBe(true);
    expect(TaskTitle.safeParse('x'.repeat(151)).success).toBe(false);
    expect(TaskTitle.safeParse('dòng 1\ndòng 2').success).toBe(false);
  });
  it('description ≤ 10 000, rỗng ⇒ null', () => {
    const base = { title: 'abc' };
    expect(CreateTaskBody.parse({ ...base, description: '  ' }).description).toBeNull();
    expect(CreateTaskBody.safeParse({ ...base, description: 'x'.repeat(10_000) }).success).toBe(
      true,
    );
    expect(CreateTaskBody.safeParse({ ...base, description: 'x'.repeat(10_001) }).success).toBe(
      false,
    );
  });
  it('DueDate: quá khứ hợp lệ, năm ngoài 2000–2100 hoặc có giờ ⇒ lỗi', () => {
    expect(DueDate.safeParse('2020-01-01').success).toBe(true);
    expect(DueDate.safeParse('1999-12-31').success).toBe(false);
    expect(DueDate.safeParse('2101-01-01').success).toBe(false);
    expect(DueDate.safeParse('2026-10-15T00:00:00Z').success).toBe(false);
  });
  it('TaskKey dạng PREFIX-n, n ≥ 1', () => {
    expect(TaskKey.safeParse('TF-1').success).toBe(true);
    expect(TaskKey.safeParse('TF-0').success).toBe(false);
    expect(TaskKey.safeParse('tf-1').success).toBe(false);
  });
});

describe('body task', () => {
  it('CreateTaskBody không nhận status/rank/createdById từ client', () => {
    expect(CreateTaskBody.safeParse({ title: 'abc' }).success).toBe(true);
    for (const extra of [{ status: 'DONE' }, { rank: 'a0' }, { createdById: ID }]) {
      expect(CreateTaskBody.safeParse({ title: 'abc', ...extra }).success).toBe(false);
    }
  });
  it('UpdateTaskBody cần expectedVersion và ít nhất một trường', () => {
    expect(UpdateTaskBody.safeParse({ title: 'abc' }).success).toBe(false);
    expect(UpdateTaskBody.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(UpdateTaskBody.safeParse({ expectedVersion: 0, title: 'abc' }).success).toBe(false);
    expect(UpdateTaskBody.safeParse({ expectedVersion: 1, dueDate: null }).success).toBe(true);
  });
  it('MoveTaskBody: anchor uuid hoặc null', () => {
    expect(MoveTaskBody.safeParse({ expectedVersion: 2, status: 'REVIEW' }).success).toBe(true);
    expect(
      MoveTaskBody.safeParse({ expectedVersion: 2, afterId: null, beforeId: ID }).success,
    ).toBe(true);
    expect(MoveTaskBody.safeParse({ expectedVersion: 2, afterId: 'x' }).success).toBe(false);
    expect(MoveTaskBody.safeParse({ expectedVersion: 2, status: 'BLOCKED' }).success).toBe(false);
  });
  it('AssignTaskBody: assigneeId bắt buộc (null = bỏ gán)', () => {
    expect(AssignTaskBody.safeParse({ expectedVersion: 1, assigneeId: null }).success).toBe(true);
    expect(AssignTaskBody.safeParse({ expectedVersion: 1 }).success).toBe(false);
  });
});

describe('query task', () => {
  it('ListTasksQuery: limit 1–500 mặc định 200, assigneeId uuid|"none"', () => {
    expect(ListTasksQuery.parse({})).toEqual({ limit: 200 });
    expect(ListTasksQuery.safeParse({ limit: '501' }).success).toBe(false);
    expect(ListTasksQuery.safeParse({ assigneeId: 'none' }).success).toBe(true);
    expect(ListTasksQuery.safeParse({ assigneeId: 'me' }).success).toBe(false);
  });
  it('DeleteTaskQuery: expectedVersion tùy chọn, ép kiểu', () => {
    expect(DeleteTaskQuery.parse({})).toEqual({});
    expect(DeleteTaskQuery.parse({ expectedVersion: '3' })).toEqual({ expectedVersion: 3 });
  });
});

describe('DTO', () => {
  it('TaskDto đầy đủ để FE không phải refetch', () => {
    expect(TaskDto.safeParse(sampleTask).success).toBe(true);
    expect(TaskDto.safeParse({ ...sampleTask, version: 0 }).success).toBe(false);
    expect(TaskDto.safeParse({ ...sampleTask, dueDate: '2026-10-15T00:00:00Z' }).success).toBe(
      false,
    );
  });
  it('VersionConflictDetails chứa task hiện tại', () => {
    expect(
      VersionConflictDetails.safeParse({ currentVersion: 1, current: sampleTask }).success,
    ).toBe(true);
  });
});
