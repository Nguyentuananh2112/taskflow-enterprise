import type { IClock, IIdGenerator } from '../../../core/domain';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import type { NotificationRecord, NotificationType } from '../domain/notification';
import type {
  CanManageHr,
  INotificationAudience,
  INotificationRealtime,
  INotificationStore,
} from './ports';

export type NotificationRecipient = { kind: 'user'; userId: string } | { kind: 'hr' };

export interface NotifyInput {
  workspaceId: string;
  type: NotificationType;
  refId: string;
  /** Người gây ra — không bao giờ tự nhận thông báo của chính mình. */
  actorId: string;
  /** `hr` ⇒ mọi thành viên HIỆN có `hr:manage` trong ws (đọc trong cùng transaction). */
  recipient: NotificationRecipient;
}

export class NotifyOutsideTransactionError extends Error {
  constructor() {
    super('notify() phải gọi bên trong uow.run() của thay đổi nghiệp vụ (ADR-123).');
    this.name = 'NotifyOutsideTransactionError';
  }
}

export interface NotificationPublisherDeps {
  store: INotificationStore;
  audience: INotificationAudience;
  canManageHr: CanManageHr;
  realtime: INotificationRealtime;
  uow: IUnitOfWork;
  ids: IIdGenerator;
  clock: IClock;
}

/**
 * Port ghi thông báo cho attendance / leave / workspace (ADR-123). Ghi TRONG transaction của bên gọi
 * (rollback ⇒ không còn dòng nào, không event); `notification:new` chỉ phát SAU commit
 * (`uow.afterCommit`, best-effort). Payload event chỉ id + loại + ws (SEC-HR-20).
 */
export class NotificationPublisher {
  constructor(private readonly d: NotificationPublisherDeps) {}

  async notify(input: NotifyInput): Promise<void> {
    if (!this.d.uow.inTransaction) throw new NotifyOutsideTransactionError();
    const recipients = (await this.#recipientsOf(input)).filter((id) => id !== input.actorId);
    if (recipients.length === 0) return;

    const createdAt = this.d.clock.now();
    const records: NotificationRecord[] = recipients.map((recipientId) => ({
      id: this.d.ids.next(),
      workspaceId: input.workspaceId,
      recipientId,
      type: input.type,
      refId: input.refId,
      actorId: input.actorId,
      readAt: null,
      createdAt,
    }));
    await this.d.store.addMany(records);

    const meta = { actorId: input.actorId, originClientId: null };
    // Mỗi người nhận một hook: UoW cô lập lỗi theo hook ⇒ một lần phát lỗi không làm mất event của
    // người nhận sau (review B — L1).
    for (const r of records) {
      this.d.uow.afterCommit(() =>
        this.d.realtime.notifyNotification(
          {
            recipientId: r.recipientId,
            notificationId: r.id,
            type: r.type,
            workspaceId: r.workspaceId,
          },
          meta,
        ),
      );
    }
  }

  async #recipientsOf(input: NotifyInput): Promise<string[]> {
    if (input.recipient.kind === 'user') return [input.recipient.userId];
    const members = await this.d.audience.membersOf(input.workspaceId);
    return [
      ...new Set(members.filter((m) => this.d.canManageHr(m.role, m.grants)).map((m) => m.userId)),
    ];
  }
}
