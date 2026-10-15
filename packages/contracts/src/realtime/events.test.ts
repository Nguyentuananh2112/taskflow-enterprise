import { describe, expect, it } from 'vitest';

import {
  AuditLogDto,
  AuthRenewPayload,
  ProjectJoinPayload,
  REALTIME_EVENTS,
  SocketAck,
  TaskDeletedEvent,
  TaskMovedEvent,
  TaskUpdatedEvent,
} from '../index';
import { ID, sampleTask } from '../__fixtures__/task';

const envelope = (type: string, data: unknown) => ({
  eventId: ID,
  type,
  occurredAt: '2026-10-15T08:00:00.000Z',
  actorId: ID,
  originClientId: null,
  data,
});

describe('client → server', () => {
  it('ProjectJoinPayload cần workspaceId + projectId', () => {
    expect(ProjectJoinPayload.safeParse({ workspaceId: ID, projectId: ID }).success).toBe(true);
    expect(ProjectJoinPayload.safeParse({ projectId: ID }).success).toBe(false);
  });
  it('AuthRenewPayload không rỗng', () => {
    expect(AuthRenewPayload.safeParse({ token: '' }).success).toBe(false);
  });
  it('SocketAck: ok hoặc mã lỗi trong danh mục', () => {
    expect(SocketAck.safeParse({ ok: true }).success).toBe(true);
    expect(SocketAck.safeParse({ ok: false, code: 'RESOURCE_NOT_FOUND' }).success).toBe(true);
    expect(SocketAck.safeParse({ ok: false, code: 'NOPE' }).success).toBe(false);
  });
});

describe('server → client', () => {
  it('task:moved mang TaskDto đầy đủ + from/to', () => {
    const data = {
      task: sampleTask,
      from: { status: 'TODO', rank: 'a0' },
      to: { status: 'IN_PROGRESS', rank: 'b0' },
    };
    expect(TaskMovedEvent.safeParse(envelope('task:moved', data)).success).toBe(true);
    expect(TaskMovedEvent.safeParse(envelope('task:updated', data)).success).toBe(false);
  });
  it('task:updated cần ít nhất một changedField hợp lệ', () => {
    const ok = envelope('task:updated', { task: sampleTask, changedFields: ['assignee'] });
    expect(TaskUpdatedEvent.safeParse(ok).success).toBe(true);
    const bad = envelope('task:updated', { task: sampleTask, changedFields: [] });
    expect(TaskUpdatedEvent.safeParse(bad).success).toBe(false);
  });
  it('originClientId không phải uuid ⇒ không hợp lệ (server phải gửi null)', () => {
    const ev = {
      ...envelope('task:deleted', { taskId: ID, projectId: ID, key: 'TF-1', version: 2 }),
      originClientId: 'tab-1',
    };
    expect(TaskDeletedEvent.safeParse(ev).success).toBe(false);
  });
  it('tên event là hằng số khớp tài liệu', () => {
    expect(REALTIME_EVENTS.workspaceAccessRevoked).toBe('workspace:access-revoked');
  });
});

describe('audit', () => {
  it('AuditLogDto: old/new là object hoặc null', () => {
    const base = {
      id: ID,
      taskId: ID,
      action: 'ASSIGNEE_CHANGED',
      actor: { id: ID, fullName: 'Pam' },
      oldValue: { assigneeId: null },
      newValue: { assigneeId: ID },
      createdAt: '2026-10-15T08:00:00.000Z',
    };
    expect(AuditLogDto.safeParse(base).success).toBe(true);
    expect(AuditLogDto.safeParse({ ...base, action: 'RENAMED' }).success).toBe(false);
    expect(AuditLogDto.safeParse({ ...base, oldValue: 'x' }).success).toBe(false);
  });
});
