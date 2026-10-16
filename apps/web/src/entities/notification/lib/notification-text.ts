import type { LeaveType, NotificationDto } from '@taskflow/contracts/hr';

// Web dựng câu chữ từ type + ngữ cảnh join sẵn (ADR-123: thông báo không chép nội dung nghiệp vụ;
// đơn nghỉ KHÔNG có lý do). Tên người/ workspace hiển thị như TEXT (React tự escape — E2E-HR-08).

export const LEAVE_TYPE_LABEL: Readonly<Record<LeaveType, string>> = {
  ANNUAL: 'phép năm',
  SICK: 'ốm',
  PERSONAL_PAID: 'việc riêng có lương',
  UNPAID: 'không lương',
  OTHER: 'khác',
};

const vnDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const range = (l: NonNullable<NotificationDto['leave']>) =>
  l.startDate === l.endDate ? vnDate(l.startDate) : `${vnDate(l.startDate)}–${vnDate(l.endDate)}`;

export function notificationText(n: NotificationDto): string {
  const who = n.actor?.fullName ?? 'Ai đó';
  const leave = n.leave ? `nghỉ ${LEAVE_TYPE_LABEL[n.leave.type]} ${range(n.leave)}` : 'nghỉ';
  switch (n.type) {
    case 'LEAVE_SUBMITTED':
      return `${who} gửi đơn ${leave}`;
    case 'LEAVE_APPROVED':
      return `Đơn ${leave} của bạn đã được duyệt`;
    case 'LEAVE_REJECTED':
      return `Đơn ${leave} của bạn bị từ chối`;
    case 'LEAVE_CANCELLED':
      return `${who} đã hủy đơn ${leave}`;
    case 'LEAVE_REVOKED':
      return `Đơn ${leave} của bạn đã bị thu hồi`;
    case 'ATTENDANCE_ADJUSTED':
      return `${who} đã điều chỉnh chấm công của bạn`;
    case 'HR_GRANTED':
      return 'Bạn được cấp quyền Quản lý nhân sự';
    case 'HR_REVOKED':
      return 'Quyền Quản lý nhân sự của bạn đã bị thu hồi';
  }
}

/** Nơi mở khi bấm thông báo. */
export function notificationHref(n: NotificationDto): string {
  const ws = `/w/${n.workspaceId}`;
  switch (n.type) {
    case 'LEAVE_SUBMITTED':
      return `${ws}/hr?tab=leave`;
    case 'LEAVE_APPROVED':
    case 'LEAVE_REJECTED':
    case 'LEAVE_CANCELLED':
    case 'LEAVE_REVOKED':
      return `${ws}/leave`;
    case 'ATTENDANCE_ADJUSTED':
      return `${ws}/attendance`;
    case 'HR_GRANTED':
    case 'HR_REVOKED':
      return `${ws}/projects`;
  }
}
