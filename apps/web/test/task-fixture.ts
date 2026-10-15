import type { TaskDto } from '@taskflow/contracts/task';

// Dữ liệu task mẫu cho unit test (không phải dữ liệu thật — ADR-072).

export const WS_ID = '0199e5a2-0000-7000-8000-000000000001';
export const PROJECT_ID = '0199e5a2-0000-7000-8000-000000000002';
export const USER_A = { id: '0199e5a2-0000-7000-8000-0000000000a1', fullName: 'Trần Lan' };
export const USER_B = { id: '0199e5a2-0000-7000-8000-0000000000b2', fullName: 'Nguyễn An' };

let seq = 0;

/** uuid v7-dạng, xác định theo thứ tự gọi (dễ đọc khi test fail). */
export function fakeId(): string {
  seq += 1;
  return `0199e5a2-0000-7000-8000-${String(seq).padStart(12, '0')}`;
}

export function makeTask(overrides: Partial<TaskDto> = {}): TaskDto {
  const id = overrides.id ?? fakeId();
  const number = overrides.number ?? 100 + seq;
  return {
    id,
    workspaceId: WS_ID,
    projectId: PROJECT_ID,
    number,
    key: `TF-${number}`,
    title: `Task ${number}`,
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    rank: 'a0',
    version: 1,
    dueDate: null,
    assignee: null,
    createdBy: USER_A,
    createdAt: '2026-10-15T08:00:00.000Z',
    updatedAt: '2026-10-15T08:00:00.000Z',
    ...overrides,
  };
}
