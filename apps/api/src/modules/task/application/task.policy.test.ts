import { describe, expect, it } from 'vitest';

import { actor, contractsPermissions, U, type Person } from '../testing/task-harness';
import { TaskPolicy } from './task.policy';

// test-spec-task.md §2 (TaskPolicy, dạng bảng).
const policy = new TaskPolicy(contractsPermissions);
const by = (p: Person | null) => (p === null ? null : U[p]);

describe('canDelete (§2.1, ADR-022)', () => {
  it.each([
    ['TP-D01', 'Olivia', 'Mia', true],
    ['TP-D02', 'Pam', 'Mia', true],
    ['TP-D03', 'Mia', 'Mia', true],
    ['TP-D04', 'Mia', 'Max', false],
    ['TP-D05', 'Mia', null, false],
    ['TP-D06', 'Pam', null, true],
    ['TP-D07', 'Vic', 'Vic', false],
  ] as const)('%s: %s xóa task tạo bởi %s ⇒ %s', (_, who, creator, expected) => {
    expect(policy.canDelete(actor(who), { createdById: by(creator), assigneeId: null })).toBe(
      expected,
    );
  });
});

describe('canAssign (§2.2, ADR-041)', () => {
  it.each([
    ['TP-A01', 'Pam', 'Mia', null, 'Max', true],
    ['TP-A02', 'Olivia', 'Pam', 'Max', null, true],
    ['TP-A03', 'Mia', 'Mia', null, 'Max', true],
    ['TP-A04', 'Mia', 'Mia', 'Max', null, true],
    ['TP-A05', 'Mia', 'Pam', null, 'Mia', true],
    ['TP-A06', 'Mia', 'Pam', 'Mia', null, true],
    ['TP-A07', 'Mia', 'Pam', null, 'Max', false],
    ['TP-A08', 'Mia', 'Pam', 'Max', 'Mia', false],
    ['TP-A09', 'Mia', 'Pam', 'Max', null, false],
    ['TP-A10', 'Mia', 'Pam', 'Mia', 'Max', false],
    ['TP-A11', 'Vic', 'Pam', null, 'Vic', false],
    ['TP-A12', 'Mia', null, null, 'Mia', true],
  ] as const)(
    '%s: %s, task(%s, → %s) gán cho %s ⇒ %s',
    (_, who, creator, assignee, target, expected) => {
      expect(
        policy.canAssign(
          actor(who),
          { createdById: by(creator), assigneeId: by(assignee) },
          by(target),
        ),
      ).toBe(expected);
    },
  );
});

describe('canAssignOnCreate (§2.3)', () => {
  it.each([
    ['TP-AC01', 'Mia', undefined, true],
    ['TP-AC02', 'Mia', 'Mia', true],
    ['TP-AC03', 'Mia', 'Max', false],
    ['TP-AC04', 'Pam', 'Max', true],
    ['TP-AC05', 'Olivia', 'Mia', true],
  ] as const)('%s: %s tạo với assignee %s ⇒ %s', (_, who, target, expected) => {
    expect(policy.canAssignOnCreate(actor(who), target === undefined ? undefined : U[target])).toBe(
      expected,
    );
  });
});

describe('canUpdate / canMove / canCreate (§2.4)', () => {
  it('TP-U01: OWNER/PM/MEMBER được cả ba', () => {
    for (const who of ['Olivia', 'Pam', 'Mia'] as const) {
      for (const p of ['task:update', 'task:move', 'task:create'] as const) {
        expect(policy.can(actor(who), p)).toBe(true);
      }
    }
  });

  it('TP-U02: VIEWER không được cả ba, nhưng đọc được', () => {
    for (const p of ['task:update', 'task:move', 'task:create'] as const) {
      expect(policy.can(actor('Vic'), p)).toBe(false);
    }
    expect(policy.can(actor('Vic'), 'task:read')).toBe(true);
    expect(policy.can(actor('Vic'), 'audit:read')).toBe(true);
  });
});
