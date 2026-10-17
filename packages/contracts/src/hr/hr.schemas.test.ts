import { describe, expect, it } from 'vitest';

import {
  BusinessRule,
  CompanyAccessChangedEventEnvelope,
  HrAuditLogDto,
  HrConflictReason,
  MemberDto,
  NotificationDto,
  NotificationNewEvent,
  WorkspaceDto,
} from '../index';

const ID = '0199e5a2-7c1e-7cc3-9a3b-000000000001';
const NOW = '2026-10-17T01:02:03.000Z';

describe('Mốc 3 — hợp đồng dùng chung (T-037)', () => {
  it('Mốc 3.5: WorkspaceDto / MemberDto KHÔNG còn grants (quyền nhân sự là quyền công ty)', () => {
    const ws = {
      id: ID,
      name: 'W',
      slug: 'w-one',
      myRole: 'MEMBER',
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(WorkspaceDto.parse({ ...ws, myGrants: ['HR_MANAGE'] })).not.toHaveProperty('myGrants');
    const m = { userId: ID, email: 'a@b.vn', fullName: 'A', role: 'MEMBER', joinedAt: NOW };
    expect(MemberDto.parse({ ...m, grants: [] })).not.toHaveProperty('grants');
  });

  it('NotificationDto: leave KHÔNG mang lý do (B-H2) — trường lạ bị loại khi parse', () => {
    const dto = NotificationDto.parse({
      id: ID,
      type: 'LEAVE_SUBMITTED',
      refId: ID,
      actor: { id: ID, fullName: 'Mia' },
      leave: { type: 'SICK', startDate: '2026-10-20', endDate: '2026-10-21', reason: 'sốt' },
      readAt: null,
      createdAt: NOW,
    });
    expect(Object.keys(dto.leave ?? {}).sort()).toEqual(['endDate', 'startDate', 'type']);
  });

  it('event realtime: company:access-changed chỉ { role, grants }; notification:new chỉ id + loại', () => {
    expect(
      CompanyAccessChangedEventEnvelope.safeParse({
        type: 'company:access-changed',
        data: { role: 'EMPLOYEE', grants: ['HR_MANAGE'] },
        eventId: ID,
        occurredAt: NOW,
        actorId: ID,
        originClientId: null,
      }).success,
    ).toBe(true);
    const n = NotificationNewEvent.parse({
      type: 'notification:new',
      data: { notificationId: ID, type: 'ACCESS_CHANGED', workspaceId: ID, reason: 'x' },
      eventId: ID,
      occurredAt: NOW,
      actorId: ID,
      originClientId: null,
    });
    expect(Object.keys(n.data).sort()).toEqual(['notificationId', 'type']);
  });

  it('HrAuditLogDto và mã lỗi HR đã chốt (422 VIẾT HOA, 409 viết thường)', () => {
    expect(
      HrAuditLogDto.safeParse({
        id: ID,
        action: 'GRANT_SET',
        actor: { id: ID, fullName: 'Olivia' },
        targetUserId: ID,
        refId: null,
        before: { grants: [] },
        after: { grants: ['HR_MANAGE'] },
        createdAt: NOW,
      }).success,
    ).toBe(true);
    for (const rule of [
      'GRANT_NOT_ALLOWED',
      'INSUFFICIENT_BALANCE',
      'IDEMPOTENCY_KEY_REUSED',
      'OUTSIDE_RETENTION',
    ])
      expect(BusinessRule.safeParse(rule).success, rule).toBe(true);
    expect(BusinessRule.options.every((r) => r === r.toUpperCase())).toBe(true);
    expect(HrConflictReason.options.every((r) => r === r.toLowerCase())).toBe(true);
  });
});
