import type { WorkspaceRole } from '@taskflow/contracts/rbac';
import { roleHasPermission } from '@taskflow/contracts/rbac';
import type { TaskStatus } from '@taskflow/contracts/task';
import { describe, expect, it } from 'vitest';

import { USER_A, USER_B, makeTask } from '@test/task-fixture';

import {
  boardFromTasks,
  mergeIfNewer,
  removeTask,
  revertTask,
  toColumns,
  upsertTask,
} from './board-cache';
import { canAssignAnyone, canAssignTask, canDeleteTask } from './policy';
import { allowedTargets, canTransition } from './transitions';

describe('board-cache — chuẩn hóa theo id, giữ tham chiếu (frontend.md §3.2)', () => {
  it('toColumns nhóm theo status, sắp theo rank rồi id (so sánh byte)', () => {
    const a = makeTask({ rank: 'a1' });
    const b = makeTask({ rank: 'Zz' }); // chữ hoa < chữ thường
    const c = makeTask({ status: 'DONE', rank: 'a0' });
    const columns = toColumns(boardFromTasks([a, b, c]));
    expect(columns.TODO.map((t) => t.id)).toEqual([b.id, a.id]);
    expect(columns.DONE).toEqual([c]);
    expect(columns.IN_PROGRESS).toEqual([]);
  });

  it('mergeIfNewer: version lớn hơn thay; bằng/nhỏ hơn bỏ; task khác giữ nguyên tham chiếu', () => {
    const a = makeTask({ version: 3 });
    const other = makeTask();
    const board = boardFromTasks([a, other]);
    expect(mergeIfNewer(board, { ...a, version: 3, title: 'cũ' })).toBe(board);
    expect(mergeIfNewer(board, { ...a, version: 2 })).toBe(board);
    const next = mergeIfNewer(board, { ...a, version: 4, title: 'mới' });
    expect(next.byId[a.id]?.title).toBe('mới');
    expect(next.byId[other.id]).toBe(other);
  });

  it('upsert cùng tham chiếu ⇒ trả lại đúng board cũ', () => {
    const a = makeTask();
    const board = boardFromTasks([a]);
    expect(upsertTask(board, a)).toBe(board);
  });

  it('removeTask: id không có ⇒ board cũ', () => {
    const board = boardFromTasks([makeTask()]);
    expect(removeTask(board, 'khong-co')).toBe(board);
  });

  describe('revertTask — rollback có điều kiện theo từng task (§4.4)', () => {
    it('cache vẫn cùng version với base ⇒ đặt lại base', () => {
      const base = makeTask({ version: 2, status: 'TODO' });
      const optimistic = { ...base, status: 'IN_PROGRESS' as const, rank: 'b0' };
      const board = boardFromTasks([optimistic]);
      expect(revertTask(board, base).byId[base.id]).toBe(base);
    });

    it('event mới hơn đã đến giữa chừng ⇒ KHÔNG ghi đè', () => {
      const base = makeTask({ version: 2 });
      const theirs = { ...base, version: 3, title: 'người khác sửa' };
      const board = boardFromTasks([theirs]);
      expect(revertTask(board, base)).toBe(board);
    });

    it('task vắng mặt (xóa optimistic thất bại) ⇒ hiện lại', () => {
      const base = makeTask();
      expect(revertTask(boardFromTasks([]), base).byId[base.id]).toBe(base);
    });
  });
});

describe('transitions — khớp bảng T-003 §6.1 (4×4)', () => {
  const TABLE: Record<TaskStatus, Record<TaskStatus, boolean>> = {
    TODO: { TODO: true, IN_PROGRESS: true, REVIEW: false, DONE: false },
    IN_PROGRESS: { TODO: true, IN_PROGRESS: true, REVIEW: true, DONE: false },
    REVIEW: { TODO: false, IN_PROGRESS: true, REVIEW: true, DONE: true },
    DONE: { TODO: false, IN_PROGRESS: false, REVIEW: true, DONE: true },
  };
  const cases = Object.entries(TABLE).flatMap(([from, row]) =>
    Object.entries(row).map(([to, ok]) => [from as TaskStatus, to as TaskStatus, ok] as const),
  );
  it.each(cases)('%s → %s = %s', (from, to, ok) => {
    expect(canTransition(from, to)).toBe(ok);
    expect(allowedTargets(from).includes(to)).toBe(ok);
  });
});

describe('policy (ADR-022, ADR-041) — hàm thuần nhận can()', () => {
  const canFor = (role: WorkspaceRole) => (p: Parameters<typeof roleHasPermission>[1]) =>
    roleHasPermission(role, p);
  const mine = makeTask({ createdBy: USER_A });
  const theirs = makeTask({ createdBy: USER_B });
  const orphan = makeTask({ createdBy: null });

  it.each([
    ['OWNER', theirs, true],
    ['PM', orphan, true],
    ['MEMBER', mine, true],
    ['MEMBER', theirs, false],
    ['MEMBER', orphan, false], // createdBy null ⇒ chỉ :any
    ['VIEWER', mine, false],
  ] as const)('canDeleteTask %s', (role, task, expected) => {
    expect(canDeleteTask(canFor(role), USER_A.id, task)).toBe(expected);
  });

  it('PM/OWNER gán mọi task cho bất kỳ ai', () => {
    expect(canAssignTask(canFor('PM'), USER_A.id, theirs, USER_B.id)).toBe(true);
    expect(canAssignAnyone(canFor('OWNER'), USER_A.id, theirs)).toBe(true);
  });

  it('MEMBER: task mình tạo ⇒ gán ai cũng được', () => {
    expect(canAssignTask(canFor('MEMBER'), USER_A.id, mine, USER_B.id)).toBe(true);
    expect(canAssignAnyone(canFor('MEMBER'), USER_A.id, mine)).toBe(true);
  });

  it('MEMBER: task người khác trống ⇒ chỉ tự nhận', () => {
    expect(canAssignTask(canFor('MEMBER'), USER_A.id, theirs, USER_A.id)).toBe(true);
    expect(canAssignTask(canFor('MEMBER'), USER_A.id, theirs, USER_B.id)).toBe(false);
    expect(canAssignAnyone(canFor('MEMBER'), USER_A.id, theirs)).toBe(false);
  });

  it('MEMBER: task người khác đang gán cho mình ⇒ chỉ tự bỏ nhận', () => {
    const assignedToMe = { ...theirs, assignee: USER_A };
    expect(canAssignTask(canFor('MEMBER'), USER_A.id, assignedToMe, null)).toBe(true);
    expect(canAssignTask(canFor('MEMBER'), USER_A.id, assignedToMe, USER_B.id)).toBe(false);
  });

  it('MEMBER: task người khác đang gán cho người khác ⇒ không', () => {
    const assigned = { ...theirs, assignee: USER_B };
    expect(canAssignTask(canFor('MEMBER'), USER_A.id, assigned, USER_A.id)).toBe(false);
    expect(canAssignTask(canFor('MEMBER'), USER_A.id, assigned, null)).toBe(false);
  });

  it('VIEWER không gán gì; chưa biết người xem ⇒ không', () => {
    expect(canAssignTask(canFor('VIEWER'), USER_A.id, mine, USER_A.id)).toBe(false);
    expect(canAssignTask(canFor('MEMBER'), null, theirs, null)).toBe(false);
  });
});

describe('tempRankBetween (fractional-indexing 4.0.0)', () => {
  it('giữa hai hàng xóm hợp lệ', async () => {
    const { tempRankBetween } = await import('./temp-rank');
    const rank = tempRankBetween('a0', 'a1');
    expect(rank !== null && rank > 'a0' && rank < 'a1').toBe(true);
    expect(tempRankBetween(null, null)).toBe('a0');
  });

  it('hàng xóm lệch (after ≥ before) ⇒ null — thư viện KHÔNG tự ném lỗi trường hợp này', async () => {
    const { tempRankBetween } = await import('./temp-rank');
    expect(tempRankBetween('a2', 'a1')).toBeNull();
    expect(tempRankBetween('a1', 'a1')).toBeNull();
  });

  it('khóa sai định dạng ⇒ null', async () => {
    const { tempRankBetween } = await import('./temp-rank');
    expect(tempRankBetween('b0', null)).toBeNull();
  });
});
