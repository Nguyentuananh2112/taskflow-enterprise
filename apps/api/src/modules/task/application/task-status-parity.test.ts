import { ROLE_RANK, TASK_STATUS_ORDER, TASK_STATUS_TRANSITIONS } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { ALLOWED_TRANSITIONS, TASK_PRIORITIES, TASK_STATUSES } from '../domain/task-status';

// Parity bắt buộc (ADR-043/080): domain là nguồn sự thật, contracts là bản sao cho FE. Đặt ở
// application vì domain không được import contracts (eslint DOMAIN_FORBIDDEN_IMPORTS).
describe('parity domain ↔ @taskflow/contracts', () => {
  it('TE-M19: ALLOWED_TRANSITIONS = TASK_STATUS_TRANSITIONS (so theo tập)', () => {
    const asSets = (t: Readonly<Record<string, readonly string[]>>) =>
      Object.fromEntries(Object.entries(t).map(([k, v]) => [k, new Set(v)]));
    expect(asSets(ALLOWED_TRANSITIONS)).toEqual(asSets(TASK_STATUS_TRANSITIONS));
  });

  it('thứ tự cột và danh sách priority khớp', () => {
    expect([...TASK_STATUSES]).toEqual([...TASK_STATUS_ORDER]);
    expect([...TASK_PRIORITIES]).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
  });

  it('TP-P02: ROLE_RANK OWNER 4 > PM 3 > MEMBER 2 > VIEWER 1 (security.md §3.1)', () => {
    expect(ROLE_RANK).toEqual({ OWNER: 4, PM: 3, MEMBER: 2, VIEWER: 1 });
  });
});
