import { afterEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_ID, WS_ID, makeTask } from '@test/task-fixture';

import { taskApi } from '@/entities/task';
import { ApiError } from '@/shared/api';

import {
  EditConflictError,
  EditTaskSchema,
  conflictingFields,
  diffChanges,
  toFormValues,
} from './rebase';
import { sendUpdate } from './use-update-task';

// Rebase 3 chiều khi sửa trong drawer (frontend.md §4.6) — bắt buộc theo §8.1.

const scope = { wsId: WS_ID, projectId: PROJECT_ID };
const conflict = (current: ReturnType<typeof makeTask>) =>
  new ApiError({
    status: 409,
    code: 'VERSION_CONFLICT',
    message: 'conflict',
    details: { currentVersion: current.version, current },
  });

afterEach(() => vi.restoreAllMocks());

describe('conflictingFields', () => {
  const base = makeTask({ title: 'Gốc', priority: 'LOW', version: 2 });

  it('người khác chỉ kéo task (status/rank/version) ⇒ không xung đột', () => {
    const theirs = { ...base, status: 'IN_PROGRESS' as const, rank: 'b0', version: 3 };
    expect(conflictingFields(base, { title: 'Của tôi' }, theirs)).toEqual([]);
  });

  it('người khác sửa field KHÁC field mình sửa ⇒ không xung đột', () => {
    const theirs = { ...base, priority: 'HIGH' as const, version: 3 };
    expect(conflictingFields(base, { title: 'Của tôi' }, theirs)).toEqual([]);
  });

  it('cùng sửa một field sang giá trị khác ⇒ xung đột field đó', () => {
    const theirs = { ...base, title: 'Của họ', version: 3 };
    expect(conflictingFields(base, { title: 'Của tôi', priority: 'URGENT' }, theirs)).toEqual([
      'title',
    ]);
  });

  it('cùng sửa sang CÙNG giá trị ⇒ không xung đột', () => {
    const theirs = { ...base, title: 'Như nhau', version: 3 };
    expect(conflictingFields(base, { title: 'Như nhau' }, theirs)).toEqual([]);
  });
});

describe('form ↔ body', () => {
  it('dueDate rỗng ⇒ null, mô tả rỗng ⇒ null; diff chỉ field đổi', () => {
    const base = makeTask({ title: 'Viết spec', dueDate: '2026-10-20', description: 'abc' });
    const values = EditTaskSchema.parse({ ...toFormValues(base), dueDate: '', description: '   ' });
    expect(diffChanges(base, values)).toEqual({ dueDate: null, description: null });
  });

  it('không đổi gì ⇒ {}', () => {
    const base = makeTask();
    expect(diffChanges(base, EditTaskSchema.parse(toFormValues(base)))).toEqual({});
  });
});

describe('sendUpdate', () => {
  const base = makeTask({ title: 'Gốc', version: 2 });

  it('409 không xung đột ⇒ tự gửi lại đúng 1 lần với version của server', async () => {
    const theirs = { ...base, status: 'REVIEW' as const, version: 3 };
    const saved = { ...theirs, title: 'Của tôi', version: 4 };
    const spy = vi
      .spyOn(taskApi, 'update')
      .mockRejectedValueOnce(conflict(theirs))
      .mockResolvedValueOnce(saved);
    await expect(sendUpdate(scope, { base, changes: { title: 'Của tôi' } })).resolves.toBe(saved);
    expect(spy.mock.calls.map((c) => c[2].expectedVersion)).toEqual([2, 3]);
  });

  it('409 có xung đột ⇒ EditConflictError (kèm bản mới nhất + field), không gửi lại', async () => {
    const theirs = { ...base, title: 'Của họ', version: 3 };
    const spy = vi.spyOn(taskApi, 'update').mockRejectedValue(conflict(theirs));
    const error = await sendUpdate(scope, { base, changes: { title: 'Của tôi' } }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EditConflictError);
    expect((error as EditConflictError).fields).toEqual(['title']);
    expect((error as EditConflictError).theirs).toEqual(theirs);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('lỗi khác ⇒ ném nguyên', async () => {
    const error = new ApiError({ status: 422, code: 'PROJECT_ARCHIVED', message: 'x' });
    vi.spyOn(taskApi, 'update').mockRejectedValue(error);
    await expect(sendUpdate(scope, { base, changes: { title: 'Của tôi' } })).rejects.toBe(error);
  });
});
