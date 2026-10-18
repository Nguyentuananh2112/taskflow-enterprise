import {
  LEAVE_POLICY_DEFAULTS,
  type LeavePolicyDto,
  type LeavePolicyFields,
} from '@taskflow/contracts/leave';
import type { UserRefDto } from '@taskflow/contracts/auth';

// Chính sách phép theo năm (ADR-131, T-058c trên contract D T-057): một bộ cho cả công ty; năm chưa có dòng ⇒ dòng gần
// nhất trước đó (INHERITED), không có ⇒ mức luật (DEFAULT). Năm hiện tại + năm sau sửa được.

type Row = LeavePolicyFields & { version: number; updatedAt: string; updatedBy: UserRefDto };

export class MockPolicies {
  readonly rows = new Map<number, Row>();
  constructor(private readonly today: () => string) {}

  /** Chính sách hiệu lực của năm (đọc lười như server). */
  fields(year: number): LeavePolicyFields {
    return this.#source(year).fields;
  }

  #source(year: number) {
    const own = this.rows.get(year);
    if (own) return { fields: own, source: 'SET' as const, from: null, row: own };
    const before = [...this.rows.keys()].filter((y) => y < year).sort((a, b) => b - a)[0];
    const inherited = before === undefined ? undefined : this.rows.get(before);
    return inherited
      ? { fields: inherited, source: 'INHERITED' as const, from: before ?? null, row: null }
      : { fields: LEAVE_POLICY_DEFAULTS, source: 'DEFAULT' as const, from: null, row: null };
  }

  editable(year: number): boolean {
    const now = Number(this.today().slice(0, 4));
    return year === now || year === now + 1;
  }

  dto(year: number): LeavePolicyDto {
    const s = this.#source(year);
    const f = s.fields;
    return {
      annualDays: f.annualDays,
      seniorityStepYears: f.seniorityStepYears,
      seniorityBonusDays: f.seniorityBonusDays,
      carryOverEnabled: f.carryOverEnabled,
      carryOverMaxDays: f.carryOverMaxDays,
      carryOverExpiryMonth: f.carryOverExpiryMonth,
      year,
      source: s.source,
      inheritedFromYear: s.from,
      version: s.row?.version ?? 0,
      editable: this.editable(year),
      updatedAt: s.row?.updatedAt ?? null,
      updatedBy: s.row?.updatedBy ?? null,
    };
  }

  set(year: number, fields: LeavePolicyFields, by: UserRefDto, at: string): void {
    const version = (this.rows.get(year)?.version ?? 0) + 1;
    this.rows.set(year, { ...fields, version, updatedAt: at, updatedBy: by });
  }
}

/** Ngày cuối tháng `month` (1..12) của năm `year` — hạn dùng phép chuyển sang (tháng 2 theo năm nhuận). */
export function endOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** Số năm tròn từ `hireDate` tính tới 31/12/`year` (ADR-131 — mốc thâm niên trong năm). */
export function yearsAtEndOf(hireDate: string, year: number): number {
  // Tới 31/12 thì ngày kỷ niệm của năm đó luôn đã qua ⇒ chỉ còn hiệu số năm.
  return Math.max(0, year - Number(hireDate.slice(0, 4)));
}
