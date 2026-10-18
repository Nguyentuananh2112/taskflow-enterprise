import type {
  CorrectionDto,
  CorrectionStatus,
  SubmitCorrectionBody,
} from '@taskflow/contracts/attendance';
import type { UserRefDto } from '@taskflow/contracts/auth';

import { COMPANY_SCOPE } from './mock-guard';
import { localToEpoch, type MockHr } from './mock-hr';

// Đơn bổ sung giờ (ADR-129, T-058b trên contract A T-056) — bản RÚT GỌN của luật gửi 1–6 (luật thật: domain thuần của
// A). Đủ để màn hình thấy mọi mã lỗi; không mô phỏng retention / khóa.

type Row = Omit<CorrectionDto, 'day' | 'reason'> & { reason: string; key: string };

const firstOfPrevMonth = (today: string) => {
  const [y = 0, m = 1] = today.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return `${prev}-01`;
};

export class MockCorrections {
  readonly rows: Row[] = [];
  constructor(private readonly hr: MockHr) {}

  #iso = () => new Date(this.hr.db.now()).toISOString();

  dto(row: Row, withReason: boolean): CorrectionDto {
    const { key: _key, reason, ...rest } = row;
    return {
      ...rest,
      ...(withReason ? { reason } : {}),
      day: this.hr.day(COMPANY_SCOPE, row.userId, row.date),
    };
  }

  /** Luật gửi (rút gọn) ⇒ mã `details.rule`, hoặc null khi hợp lệ. Gọi lại lúc duyệt. */
  rule(userId: string, b: Pick<SubmitCorrectionBody, 'date' | 'kind' | 'time' | 'nextDay'>) {
    const today = this.hr.attendance.today();
    const start = this.hr.db.company.row(userId)?.startDate ?? '0000-01-01';
    const from = [firstOfPrevMonth(today), start].sort().at(-1) ?? today;
    if (b.date > today || b.date < from) return 'CORRECTION_DATE_OUT_OF_RANGE';
    const at = localToEpoch(b.date, b.time, b.nextDay);
    if (at > this.hr.db.now()) return 'CORRECTION_IN_FUTURE';
    const day = this.hr.day(COMPANY_SCOPE, userId, b.date);
    if (day.leave === 'FULL') return 'CORRECTION_DAY_ON_LEAVE';
    const firstIn = day.firstIn ? Date.parse(day.firstIn) : null;
    const lastOut = day.lastOut ? Date.parse(day.lastOut) : null;
    if (b.kind === 'IN' && firstIn !== null) return 'CORRECTION_EVENT_EXISTS';
    if (b.kind === 'OUT' && lastOut !== null && firstIn !== null && lastOut > firstIn)
      return 'CORRECTION_EVENT_EXISTS';
    if (b.kind === 'OUT' && (firstIn === null || at <= firstIn)) return 'CORRECTION_TIME_ORDER';
    if (b.kind === 'IN' && lastOut !== null && at >= lastOut) return 'CORRECTION_TIME_ORDER';
    return null;
  }

  pending(userId: string, date: string, kind: string) {
    return this.rows.find(
      (r) => r.userId === userId && r.date === date && r.kind === kind && r.status === 'PENDING',
    );
  }

  add(user: UserRefDto, b: SubmitCorrectionBody, key: string): Row {
    const now = this.#iso();
    const row: Row = {
      id: crypto.randomUUID(),
      userId: user.id,
      user,
      date: b.date,
      kind: b.kind,
      time: b.time,
      nextDay: b.nextDay,
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdEventId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      reason: b.reason,
      key,
    };
    this.rows.unshift(row);
    return row;
  }

  decide(row: Row, status: CorrectionStatus, by: UserRefDto | null, note: string | null) {
    Object.assign(row, {
      status,
      decidedBy: by,
      decidedAt: by ? this.#iso() : null,
      decisionNote: note,
      version: row.version + 1,
      updatedAt: this.#iso(),
    });
  }

  /** Duyệt = đúng đường HR thêm lượt (ADJUSTMENT); note của lượt KHÔNG chép lý do nhân viên. */
  approve(row: Row, by: UserRefDto, note: string | null): string {
    const at = localToEpoch(row.date, row.time, row.nextDay);
    const id = this.hr.attendance.adjust(COMPANY_SCOPE, row.userId, row.date, {
      kind: row.kind,
      at,
      by,
      note: `Đơn bổ sung giờ ${row.id}`,
    });
    this.decide(row, 'APPROVED', by, note);
    row.createdEventId = id;
    return id;
  }
}
