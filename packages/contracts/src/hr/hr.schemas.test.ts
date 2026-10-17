import { describe, expect, it } from 'vitest';

import {
  BusinessRule,
  HrAuditLogDto,
  HrConflictReason,
  MemberDto,
  MemberGrantsChangedEvent,
  NotificationDto,
  NotificationNewEvent,
  SetMemberGrantsBody,
  WorkspaceDto,
} from '../index';

const ID = '0199e5a2-7c1e-7cc3-9a3b-000000000001';
const NOW = '2026-10-17T01:02:03.000Z';

describe('Mốc 3 — hợp đồng dùng chung (T-037)', () => {
  it('SetMemberGrantsBody: strict, chỉ grant đã biết, không trùng quá số loại', () => {
    expect(SetMemberGrantsBody.safeParse({ grants: ['HR_MANAGE'] }).success).toBe(true);
    expect(SetMemberGrantsBody.safeParse({ grants: [] }).success).toBe(true);
    expect(SetMemberGrantsBody.safeParse({ grants: ['ADMIN'] }).success).toBe(false);
    expect(SetMemberGrantsBody.safeParse({ grants: ['HR_MANAGE', 'HR_MANAGE'] }).success).toBe(
      false,
    );
    expect(SetMemberGrantsBody.safeParse({ grants: [], role: 'OWNER' }).success).toBe(false);
  });

  it('WorkspaceDto.myGrants và MemberDto.grants là bắt buộc', () => {
    const ws = {
      id: ID,
      name: 'W',
      slug: 'w-one',
      myRole: 'MEMBER',
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(WorkspaceDto.safeParse(ws).success).toBe(false);
    expect(WorkspaceDto.safeParse({ ...ws, myGrants: ['HR_MANAGE'] }).success).toBe(true);
    const m = { userId: ID, email: 'a@b.vn', fullName: 'A', role: 'MEMBER', joinedAt: NOW };
    expect(MemberDto.safeParse(m).success).toBe(false);
    expect(MemberDto.safeParse({ ...m, grants: [] }).success).toBe(true);
  });

  it('NotificationDto: leave KHÔNG mang lý do (B-H2) — trường lạ bị loại khi parse', () => {
    const dto = NotificationDto.parse({
      id: ID,
      type: 'LEAVE_SUBMITTED',
      refId: ID,
      workspaceId: ID,
      workspaceName: 'Acme',
      actor: { id: ID, fullName: 'Mia' },
      leave: { type: 'SICK', startDate: '2026-10-20', endDate: '2026-10-21', reason: 'sốt' },
      readAt: null,
      createdAt: NOW,
    });
    expect(Object.keys(dto.leave ?? {}).sort()).toEqual(['endDate', 'startDate', 'type']);
  });

  it('event realtime: grants-changed chỉ { workspaceId, grants }; notification:new chỉ id + loại + ws', () => {
    expect(
      MemberGrantsChangedEvent.safeParse({
        type: 'member:grants-changed',
        data: { workspaceId: ID, grants: [] },
        eventId: ID,
        occurredAt: NOW,
        actorId: ID,
        originClientId: null,
      }).success,
    ).toBe(true);
    const n = NotificationNewEvent.parse({
      type: 'notification:new',
      data: { notificationId: ID, type: 'HR_GRANTED', workspaceId: ID, reason: 'x' },
      eventId: ID,
      occurredAt: NOW,
      actorId: ID,
      originClientId: null,
    });
    expect(Object.keys(n.data).sort()).toEqual(['notificationId', 'type', 'workspaceId']);
  });

  it('HrAuditLogDto và mã lỗi HR đã chốt (422 VIẾT HOA, 409 viết thường)', () => {
    expect(
      HrAuditLogDto.safeParse({
        id: ID,
        action: 'GRANT',
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
