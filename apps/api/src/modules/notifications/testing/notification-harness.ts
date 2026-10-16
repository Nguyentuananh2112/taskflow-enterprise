import { hasPermission } from '@taskflow/contracts';

import { FakeClock, FakeUnitOfWork, SequentialIdGenerator } from '../../../../test/support';
import type { MemberGrant, RealtimeEventMeta, WorkspaceRole } from '../../workspace';
import { NotificationPublisher } from '../application/notification-publisher';
import { NotificationQueries } from '../application/notification.queries';
import type {
  INotificationAudience,
  INotificationContextReader,
  INotificationRealtime,
  LeaveSummary,
  MemberAccess,
} from '../application/ports';
import { InMemoryNotificationStore } from '../infrastructure/in-memory-notification.store';

// Fixture chuẩn của test-spec-hr §0.2 (id dạng uuid để parse được bằng contracts).
export const W1 = '11111111-1111-7111-8111-111111111111';
export const W2 = '22222222-2222-7222-8222-222222222222';
export const U = {
  olivia: '0000000a-0000-7000-8000-00000000000a', // OWNER W1
  hana: '0000000b-0000-7000-8000-00000000000b', // MEMBER W1 + HR_MANAGE
  pam: '0000000c-0000-7000-8000-00000000000c', // PM W1
  mia: '0000000d-0000-7000-8000-00000000000d', // MEMBER W1
  max: '0000000e-0000-7000-8000-00000000000e', // MEMBER W1
  vic: '0000000f-0000-7000-8000-00000000000f', // VIEWER W1
  otto: '00000010-0000-7000-8000-000000000010', // OWNER W2
} as const;

interface Member {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  grants: MemberGrant[];
}

/** Membership HIỆN TẠI có thể đổi giữa các bước (rời ws, thu grant) — như đọc lại DB mỗi request. */
export class FakeAudience implements INotificationAudience {
  members: Member[] = [];
  readonly names = new Map<string, string>([
    [W1, 'Công ty Một'],
    [W2, 'Công ty Hai'],
  ]);
  readonly deleted = new Set<string>();

  set(workspaceId: string, userId: string, role: WorkspaceRole, grants: MemberGrant[] = []): void {
    this.remove(workspaceId, userId);
    this.members.push({ workspaceId, userId, role, grants });
  }

  remove(workspaceId: string, userId: string): void {
    this.members = this.members.filter(
      (m) => !(m.workspaceId === workspaceId && m.userId === userId),
    );
  }

  workspacesOf(userId: string) {
    return Promise.resolve(
      this.members
        .filter((m) => m.userId === userId && !this.deleted.has(m.workspaceId))
        .map((m) => ({ ...m, workspaceName: this.names.get(m.workspaceId) ?? '?' })),
    );
  }

  membersOf(workspaceId: string): Promise<MemberAccess[]> {
    return Promise.resolve(this.members.filter((m) => m.workspaceId === workspaceId));
  }
}

export class FakeContext implements INotificationContextReader {
  readonly users = new Map<string, string>();
  /** khóa `${workspaceId}:${refId}` — đơn của ws khác không khớp. */
  readonly leaves = new Map<string, LeaveSummary>();

  actorNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return Promise.resolve(
      new Map(ids.flatMap((id) => (this.users.has(id) ? [[id, this.users.get(id) ?? '']] : []))),
    );
  }

  leaveSummaries(refs: readonly { workspaceId: string; refId: string }[]) {
    const out = new Map<string, LeaveSummary>();
    for (const r of refs) {
      const hit = this.leaves.get(`${r.workspaceId}:${r.refId}`);
      if (hit) out.set(r.refId, hit);
    }
    return Promise.resolve(out as ReadonlyMap<string, LeaveSummary>);
  }
}

export interface SentEvent {
  input: { recipientId: string; notificationId: string; type: string; workspaceId: string };
  meta: RealtimeEventMeta;
}

export class SpyRealtime implements INotificationRealtime {
  readonly sent: SentEvent[] = [];
  notifyNotification(input: SentEvent['input'], meta: RealtimeEventMeta): Promise<void> {
    this.sent.push({ input, meta });
    return Promise.resolve();
  }
}

/** W1 theo fixture: Olivia OWNER, Hana MEMBER+HR, Pam PM, Mia/Max MEMBER, Vic VIEWER; W2: Otto OWNER. */
export function createNotificationHarness() {
  const store = new InMemoryNotificationStore();
  const audience = new FakeAudience();
  audience.set(W1, U.olivia, 'OWNER');
  audience.set(W1, U.hana, 'MEMBER', ['HR_MANAGE']);
  audience.set(W1, U.pam, 'PM');
  audience.set(W1, U.mia, 'MEMBER');
  audience.set(W1, U.max, 'MEMBER');
  audience.set(W1, U.vic, 'VIEWER');
  audience.set(W2, U.otto, 'OWNER');
  const context = new FakeContext();
  const realtime = new SpyRealtime();
  const uow = new FakeUnitOfWork(store);
  const clock = new FakeClock('2026-11-17T03:00:00.000Z');
  const ids = new SequentialIdGenerator();
  const canManageHr = (role: WorkspaceRole, grants: readonly MemberGrant[]) =>
    hasPermission(role, grants, 'hr:manage');
  const publisher = new NotificationPublisher({
    store,
    audience,
    canManageHr,
    realtime,
    uow,
    ids,
    clock,
  });
  const queries = new NotificationQueries({ store, audience, context, canManageHr, clock });
  /** Gọi `notify` trong một transaction như bên gọi thật (leave / attendance). */
  const notifyInTx = (input: Parameters<NotificationPublisher['notify']>[0]) =>
    uow.run(() => publisher.notify(input));
  return { store, audience, context, realtime, uow, clock, ids, publisher, queries, notifyInTx };
}
