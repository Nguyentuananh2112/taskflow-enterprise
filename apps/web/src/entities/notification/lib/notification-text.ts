import type { LeaveType, NotificationDto } from '@taskflow/contracts/hr';

// Web dựng câu chữ từ type + ngữ cảnh join sẵn (ADR-123: thông báo không chép nội dung nghiệp vụ;
// đơn nghỉ KHÔNG có lý do). Tên người hiển thị như TEXT (React tự escape — E2E-HR-08).

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
    // Mốc 3.5: quyền cấp công ty (thay HR_GRANTED / HR_REVOKED theo workspace) + nghỉ việc.
    case 'ACCESS_CHANGED':
      return 'Quyền của bạn trong công ty đã thay đổi';
    case 'OFFBOARD_SCHEDULED':
      // Gửi cả người nghỉ lẫn Admin; DTO không có tên người nghỉ ⇒ câu trung tính, chi tiết ở trang chính / Nhân sự.
      return `${who} đã lên lịch nghỉ việc — xem chi tiết`;
    case 'OFFBOARD_CLEANUP':
      return 'Đã dọn đơn nghỉ của người vừa nghỉ việc';
    // Mốc 5 (ADR-128): không mang giá trị hồ sơ — chi tiết ở trang Hồ sơ của tôi.
    case 'PROFILE_UPDATED':
      return 'Hồ sơ nhân sự của bạn đã được cập nhật';
    // Mốc 5 (ADR-129): không mang lý do của nhân viên (B-H2) — chi tiết ở trang chấm công / tab Nhân sự.
    case 'CORRECTION_SUBMITTED':
      return `${who} gửi đơn bổ sung giờ`;
    case 'CORRECTION_APPROVED':
      return 'Đơn bổ sung giờ của bạn đã được duyệt';
    case 'CORRECTION_REJECTED':
      return 'Đơn bổ sung giờ của bạn bị từ chối';
    case 'CORRECTION_CANCELLED':
      return `${who} đã hủy đơn bổ sung giờ`;
  }
}

/** Nơi mở khi bấm thông báo — route CÔNG TY ở gốc (Mốc 3.5, ADR-139), không còn `/w/[wsId]/…`. */
export function notificationHref(n: NotificationDto): string {
  switch (n.type) {
    case 'LEAVE_SUBMITTED':
      return '/hr?tab=leave';
    case 'LEAVE_APPROVED':
    case 'LEAVE_REJECTED':
    case 'LEAVE_CANCELLED':
    case 'LEAVE_REVOKED':
      return '/leave';
    case 'ATTENDANCE_ADJUSTED':
      return '/attendance';
    case 'ACCESS_CHANGED':
    case 'OFFBOARD_SCHEDULED':
      return '/w';
    case 'OFFBOARD_CLEANUP':
      return '/hr?tab=leave';
    case 'PROFILE_UPDATED':
      return '/my-profile';
    case 'CORRECTION_SUBMITTED':
    case 'CORRECTION_CANCELLED':
      return '/hr?tab=corrections';
    case 'CORRECTION_APPROVED':
    case 'CORRECTION_REJECTED':
      return '/attendance';
  }
}
