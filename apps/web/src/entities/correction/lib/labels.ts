import type { CorrectionDto, CorrectionStatus } from '@taskflow/contracts/attendance';

import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';

export const CORRECTION_STATUS_LABEL: Readonly<Record<CorrectionStatus, string>> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Bị từ chối',
  CANCELLED: 'Đã hủy',
};

/** "17:45" · "00:30 (+1)" (ra sau nửa đêm, vẫn thuộc ngày công trước). */
export const correctionTime = (c: Pick<CorrectionDto, 'time' | 'nextDay'>) =>
  c.nextDay ? `${c.time} (+1)` : c.time;

/** "Xin giờ ra 17:45" / "Xin giờ vào 08:05". */
export const correctionAsk = (c: Pick<CorrectionDto, 'kind' | 'time' | 'nextDay'>) =>
  `Xin giờ ${c.kind === 'IN' ? 'vào' : 'ra'} ${correctionTime(c)}`;

const BY_RULE: Readonly<Record<string, string>> = {
  CORRECTION_DATE_OUT_OF_RANGE:
    'Chỉ xin bổ sung cho ngày trong tháng này hoặc tháng trước (từ ngày vào làm). Ngày cũ hơn: báo bộ phận nhân sự sửa.',
  OUTSIDE_RETENTION: 'Ngày này đã quá thời hạn lưu dữ liệu chấm công.',
  CORRECTION_IN_FUTURE: 'Giờ xin bổ sung chưa tới — chỉ xin cho giờ đã qua.',
  CORRECTION_EVENT_EXISTS:
    'Ngày này đã có giờ chấm loại đó. Nếu giờ chấm sai, báo bộ phận nhân sự kiểm tra.',
  CORRECTION_TIME_ORDER: 'Giờ ra phải sau giờ vào (và giờ vào phải trước giờ ra).',
  CORRECTION_DAY_ON_LEAVE: 'Ngày này bạn nghỉ phép cả ngày — không cần bổ sung giờ.',
  REQUESTER_NOT_EMPLOYEE: 'Người gửi không còn là nhân viên — chỉ có thể từ chối đơn này.',
};
const BY_REASON: Readonly<Record<string, string>> = {
  correction_pending_exists: 'Bạn đã gửi đơn cho ngày này — đang chờ duyệt.',
  invalid_transition: 'Đơn này đã được xử lý rồi.',
};

const detail = (error: unknown, key: 'rule' | 'reason') => {
  const d = isApiError(error) ? (error.details as Record<string, unknown> | null) : null;
  const v = d?.[key];
  return typeof v === 'string' ? v : undefined;
};

/** Mã luật của lỗi 422 (để màn HR biết "chỉ còn từ chối"). */
export const correctionRule = (error: unknown) => detail(error, 'rule');

export function correctionErrorMessage(error: unknown): string {
  const rule = detail(error, 'rule');
  const reason = detail(error, 'reason');
  if (rule && BY_RULE[rule]) return BY_RULE[rule];
  if (reason && BY_REASON[reason]) return BY_REASON[reason];
  if (isApiError(error, 'VERSION_CONFLICT')) return 'Đơn vừa thay đổi — tải lại danh sách.';
  if (isApiError(error, 'RATE_LIMITED')) return 'Bạn gửi quá nhiều đơn — thử lại sau ít phút.';
  return serverErrorMessage(error);
}
