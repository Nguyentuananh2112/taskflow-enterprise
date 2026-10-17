import { FakeClock, FakeUnitOfWork, SequentialIdGenerator } from '../../../../test/support';
import type { RealtimeEventMeta } from '../../workspace';
import { NotificationPublisher } from '../application/notification-publisher';
import { NotificationQueries } from '../application/notification.queries';
import type {
  INotificationAudience,
  INotificationContextReader,
  INotificationRealtime,
  LeaveSummary,
} from '../application/ports';
import { InMemoryNotificationStore } from '../infrastructure/in-memory-notification.store';

// Fixture chuẩn của test-spec-hr §0.2, cấp công ty (Mốc 3.5 — id dạng uuid để parse được bằng contracts).
export const U = {
  olivia: '0000000a-0000-7000-8000-00000000000a', // ADMIN (có hr:manage qua role)
  hana: '0000000b-0000-7000-8000-00000000000b', // EMPLOYEE + HR_MANAGE
  pam: '0000000c-0000-7000-8000-00000000000c', // EMPLOYEE
  mia: '0000000d-0000-7000-8000-00000000000d', // EMPLOYEE
  max: '0000000e-0000-7000-8000-00000000000e', // EMPLOYEE
  vic: '0000000f-0000-7000-8000-00000000000f', // EMPLOYEE
  otto: '00000010-0000-7000-8000-000000000010', // EMPLOYEE
} as const;

interface Member {
  since: Date;
  hr: boolean;
  /** `payroll:manage` hiện tại (T-049). */
  payroll?: boolean;
}

/** Thành viên seed vào từ "thuở đầu" — mọi thông báo của test đều thuộc tư cách hiện tại. */
const EPOCH = new Date(0);

/** Tư cách công ty HIỆN TẠI, đổi được giữa các bước (thu grant, nghỉ việc) — như đọc lại DB mỗi request. */
export class FakeAudience implements INotificationAudience {
  readonly members = new Map<string, Member>();

  /** Đổi quyền HR GIỮ nguyên tư cách (như UPDATE dòng); người mới vào từ EPOCH. */
  set(userId: string, hr: boolean, payroll = false): void {
    this.members.set(userId, { since: this.members.get(userId)?.since ?? EPOCH, hr, payroll });
  }

  /** Nghỉ việc rồi được nhận lại lúc `at` ⇒ tư cách MỚI (thông báo cũ ẩn). */
  rehire(userId: string, at: Date): void {
    this.members.set(userId, { since: at, hr: false });
  }

  /** Nghỉ việc / quá `access_until`. */
  remove(userId: string): void {
    this.members.delete(userId);
  }

  accessOf(userId: string) {
    const m = this.members.get(userId);
    return Promise.resolve(
      m ? { since: m.since, canManageHr: m.hr, canManagePayroll: m.payroll === true } : null,
    );
  }

  hrRecipients(): Promise<string[]> {
    return Promise.resolve([...this.members].filter(([, m]) => m.hr).map(([id]) => id));
  }

  payrollRecipients(): Promise<string[]> {
    return Promise.resolve(
      [...this.members].filter(([, m]) => m.payroll === true).map(([id]) => id),
    );
  }
}

export class FakeContext implements INotificationContextReader {
  readonly users = new Map<string, string>();
  /** khóa = id đơn (leave cấp công ty — không còn ws). */
  readonly leaves = new Map<string, LeaveSummary>();
  /** khóa = id phiếu ⇒ kỳ `YYYY-MM` (PAYSLIP_* — T-049). */
  readonly payslips = new Map<string, string>();

  payslipPeriods(refIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return Promise.resolve(
      new Map(
        refIds.flatMap((id) => (this.payslips.has(id) ? [[id, this.payslips.get(id)!]] : [])),
      ),
    );
  }

  actorNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return Promise.resolve(
      new Map(ids.flatMap((id) => (this.users.has(id) ? [[id, this.users.get(id) ?? '']] : []))),
    );
  }

  leaveSummaries(refIds: readonly string[]) {
    const out = new Map<string, LeaveSummary>();
    for (const id of refIds) {
      const hit = this.leaves.get(id);
      if (hit) out.set(id, hit);
    }
    return Promise.resolve(out as ReadonlyMap<string, LeaveSummary>);
  }
}

export interface SentEvent {
  input: { recipientId: string; notificationId: string; type: string };
  meta: RealtimeEventMeta;
}

export class SpyRealtime implements INotificationRealtime {
  readonly sent: SentEvent[] = [];
  notifyNotification(input: SentEvent['input'], meta: RealtimeEventMeta): Promise<void> {
    this.sent.push({ input, meta });
    return Promise.resolve();
  }
}

/** Olivia ADMIN + Hana HR có `hr:manage`; còn lại là nhân viên thường. */
export function createNotificationHarness() {
  const store = new InMemoryNotificationStore();
  const audience = new FakeAudience();
  audience.set(U.olivia, true);
  audience.set(U.hana, true);
  for (const id of [U.pam, U.mia, U.max, U.vic, U.otto]) audience.set(id, false);
  const context = new FakeContext();
  const realtime = new SpyRealtime();
  const uow = new FakeUnitOfWork(store);
  const clock = new FakeClock('2026-11-17T03:00:00.000Z');
  const ids = new SequentialIdGenerator();
  const publisher = new NotificationPublisher({ store, audience, realtime, uow, ids, clock });
  const queries = new NotificationQueries({ store, audience, context, clock });
  /** Gọi `notify` trong một transaction như bên gọi thật (leave / attendance / company). */
  const notifyInTx = (input: Parameters<NotificationPublisher['notify']>[0]) =>
    uow.run(() => publisher.notify(input));
  return { store, audience, context, realtime, uow, clock, ids, publisher, queries, notifyInTx };
}
