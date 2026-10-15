import type { TaskPriority, TaskStatus } from '@taskflow/contracts/task';

// Nhãn tiếng Việt hiển thị (contracts không chứa nhãn UI — T-003 §5.3).

export const STATUS_LABEL: Readonly<Record<TaskStatus, string>> = {
  TODO: 'Cần làm',
  IN_PROGRESS: 'Đang làm',
  REVIEW: 'Kiểm duyệt',
  DONE: 'Hoàn thành',
};

export const PRIORITY_LABEL: Readonly<Record<TaskPriority, string>> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
  URGENT: 'Khẩn cấp',
};
