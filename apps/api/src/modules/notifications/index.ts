// Public API của module notifications (ADR-093): CHỈ export TYPE (index.test.ts chặn giá trị runtime).
// Module khác không gọi thẳng — composition root nối port của họ (leave `ILeaveNotifier`, attendance
// `AttendanceNotifier`, workspace) vào `NotificationPublisher.notify`.
export type {
  NotificationPublisher,
  NotificationRecipient,
  NotifyInput,
} from './application/notification-publisher';
export type { NotificationType } from './domain/notification';
