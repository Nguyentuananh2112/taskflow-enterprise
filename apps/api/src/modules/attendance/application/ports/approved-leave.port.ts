import type { LocalDate } from '../../domain/local-time';
import type { PayrollLeaveType } from '../../domain/payroll-days';
import type { LeavePart } from '../../domain/summarize-day';

/**
 * Port do BÊN DÙNG sở hữu (thiết kế §4, A#12 / D-H4): attendance hỏi các ngày nghỉ ĐÃ DUYỆT; adapter do
 * module leave viết (T-039), nối ở composition root. Tới khi T-039 xong: fake trả rỗng.
 */
/**
 * Một ngày phép đã duyệt. `type` (T-049, payroll.md ADR-126): công tính lương cần loại phép theo nửa ngày — đọc MỘT lần
 * dùng cho cả ô ngày lẫn các nửa.
 */
export interface ApprovedLeaveDay {
  userId: string;
  date: LocalDate;
  part: LeavePart;
  type: PayrollLeaveType;
}

export interface ApprovedLeavePort {
  approvedLeaves(q: {
    /** Bỏ trống = mọi người (bảng công HR). */
    userIds?: readonly string[];
    from: LocalDate;
    to: LocalDate;
  }): Promise<ApprovedLeaveDay[]>;
}
