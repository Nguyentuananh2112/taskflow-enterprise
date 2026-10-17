import { TaskDto } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { taskDtoOfRow } from './prisma-task-read-model';

// perf/task-read-raw (Info của B): hàng SQL thô ⇒ TaskDto phải khớp ĐÚNG bộ khóa của contract — thêm/bớt
// trường ở contracts mà quên sửa `SELECT` + `taskDtoOfRow` thì đỏ ở đây, không lệch âm thầm.
const row = {
  id: '0199e5a2-0000-7000-8000-000000000101',
  workspace_id: '0199e5a2-0000-7000-8000-000000000001',
  project_id: '0199e5a2-0000-7000-8000-00000000000b',
  number: 7,
  title: 'Sửa lỗi đăng nhập',
  description: null,
  status: 'IN_PROGRESS' as const,
  priority: 'HIGH' as const,
  rank: 'a0V',
  version: 3,
  due_date: new Date('2026-10-20T00:00:00.000Z'),
  created_at: new Date('2026-10-15T08:00:00.000Z'),
  updated_at: new Date('2026-10-16T09:30:00.000Z'),
  key_prefix: 'TF',
  assignee_id: '0199e5a2-0000-7000-8000-0000000000a1',
  assignee_name: 'Nguyễn Văn A',
  creator_id: null,
  creator_name: null,
};

describe('taskDtoOfRow', () => {
  it('đúng bộ khóa của TaskDto (contracts) và qua được schema', () => {
    const dto = taskDtoOfRow(row);
    expect(Object.keys(dto).sort()).toEqual(Object.keys(TaskDto.shape).sort());
    expect(TaskDto.parse(dto)).toEqual(dto);
  });

  it('key = prefix-số, ngày thuần, ISO, user null khi không có', () => {
    expect(taskDtoOfRow(row)).toMatchObject({
      key: 'TF-7',
      dueDate: '2026-10-20',
      createdAt: '2026-10-15T08:00:00.000Z',
      assignee: { id: row.assignee_id, fullName: 'Nguyễn Văn A' },
      createdBy: null,
    });
  });
});
