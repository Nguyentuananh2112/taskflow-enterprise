import type { AttendanceDayDto, CorrectionDto, UserRefDto } from '@taskflow/contracts';

import type { CorrectionRejectReason } from '../domain/correction-rules';
import { summarizeUsers, type AttendanceDeps } from './attendance-days';
import { UNKNOWN_USER } from './attendance-event-dto';
import type { CorrectionRecord } from './ports/correction-store.port';
import type { IUserRefReader } from './ports/collaborators.port';

/** Câu cho người dùng của từng luật gửi (422 `details.rule` — web rẽ nhánh theo `rule`, không theo câu). */
export const CORRECTION_RULE_MESSAGE: Readonly<Record<CorrectionRejectReason, string>> = {
  CORRECTION_DATE_OUT_OF_RANGE:
    'Chỉ xin bổ sung giờ cho ngày trong tháng này hoặc tháng trước, từ ngày vào làm, không phải ngày tương lai — ngày cũ hơn hãy báo bộ phận nhân sự.',
  OUTSIDE_RETENTION: 'Ngày này đã quá thời hạn lưu dữ liệu chấm công.',
  CORRECTION_IN_FUTURE: 'Giờ xin bổ sung chưa tới.',
  CORRECTION_EVENT_EXISTS:
    'Ngày này đã có giờ chấm loại này — đơn bổ sung không thay giờ đã chấm; giờ sai hãy báo bộ phận nhân sự.',
  CORRECTION_TIME_ORDER:
    'Giờ ra phải sau giờ vào, giờ vào phải trước giờ ra (chưa có giờ vào thì xin giờ vào trước).',
  CORRECTION_DAY_ON_LEAVE: 'Ngày này bạn nghỉ phép cả ngày.',
};

const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/**
 * Dựng `CorrectionDto` theo lô — số truy vấn cố định (một lần tên người, một lần bảng công cho mọi người trong khoảng ngày
 * của trang), không N+1. `reason` chỉ khi người đọc là người gửi hoặc HR (bên gọi quyết `withReason`).
 */
export async function toCorrectionDtos(
  d: AttendanceDeps & { users: IUserRefReader },
  rows: readonly CorrectionRecord[],
  withReason: boolean,
): Promise<CorrectionDto[]> {
  if (rows.length === 0) return [];
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const refIds = [
    ...new Set([...userIds, ...rows.flatMap((r) => (r.decidedById ? [r.decidedById] : []))]),
  ];
  const dates = rows.map((r) => r.workDate).sort();
  const [refs, days] = await Promise.all([
    d.users.findRefs(refIds),
    summarizeUsers(d, { userIds, from: dates[0]!, to: dates.at(-1)! }),
  ]);
  const ref = (id: string): UserRefDto => refs.get(id) ?? { id, fullName: UNKNOWN_USER };
  const dayOf = (r: CorrectionRecord): AttendanceDayDto =>
    days.get(r.userId)!.find((day) => day.date === r.workDate)!;
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    user: ref(r.userId),
    date: r.workDate,
    kind: r.kind,
    time: hhmm(r.minuteOfDay),
    nextDay: r.nextDay,
    status: r.status,
    decidedBy: r.decidedById ? ref(r.decidedById) : null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    createdEventId: r.createdEventId,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(withReason ? { reason: r.reason } : {}),
    day: dayOf(r),
  }));
}
