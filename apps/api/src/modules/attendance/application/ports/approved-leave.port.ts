import type { LocalDate } from '../../domain/local-time';
import type { LeavePart } from '../../domain/summarize-day';

/**
 * Port do BÊN DÙNG sở hữu (thiết kế §4, A#12 / D-H4): attendance hỏi các ngày nghỉ ĐÃ DUYỆT; adapter do
 * module leave viết (T-039), nối ở composition root. Tới khi T-039 xong: fake trả rỗng.
 */
export interface ApprovedLeavePort {
  approvedLeaves(q: {
    /** Bỏ trống = mọi người (bảng công HR). */
    userIds?: readonly string[];
    from: LocalDate;
    to: LocalDate;
  }): Promise<{ userId: string; date: LocalDate; part: LeavePart }[]>;
}
