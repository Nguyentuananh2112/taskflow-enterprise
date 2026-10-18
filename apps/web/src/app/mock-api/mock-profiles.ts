import type {
  EmployeeProfileDto,
  HireEmployeeBody,
  SeniorityDto,
} from '@taskflow/contracts/company';

// Hồ sơ nhân viên (ADR-128, T-054): 1 dòng / user, không phiên bản, KHÔNG gắn dòng công ty (người
// đã nghỉ vẫn giữ hồ sơ). Thâm niên server tính tới hôm nay theo giờ lịch.

type Profile = {
  hireDate: string | null;
  department: string | null;
  jobTitle: string | null;
  workPhone: string | null;
  version: number;
};
type Fields = {
  [K in 'hireDate' | 'department' | 'jobTitle' | 'workPhone']?: Profile[K] | undefined;
};

const EMPTY: Profile = {
  hireDate: null,
  department: null,
  jobTitle: null,
  workPhone: null,
  version: 0,
};

/** Số tháng tròn từ `from` tới `to` (YYYY-MM-DD) — ngày trong tháng chưa tới ⇒ chưa tròn tháng. */
export function seniorityOf(from: string | null, to: string): SeniorityDto | null {
  if (!from || from > to) return null;
  const [fy = 0, fm = 0, fd = 0] = from.split('-').map(Number);
  const [ty = 0, tm = 0, td = 0] = to.split('-').map(Number);
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return { years: Math.floor(months / 12), months: months % 12 };
}

export class MockProfiles {
  private readonly rows = new Map<string, Profile>();

  get(userId: string): Readonly<Profile> {
    return this.rows.get(userId) ?? EMPTY;
  }

  /** Trường hồ sơ trên dòng danh sách nhân viên (không SĐT). */
  summary(userId: string, today: string) {
    const p = this.get(userId);
    return {
      hireDate: p.hireDate,
      department: p.department,
      jobTitle: p.jobTitle,
      seniority: seniorityOf(p.hireDate, today),
      missingHireDate: p.hireDate === null,
    };
  }

  dto(
    who: Pick<EmployeeProfileDto, 'userId' | 'fullName' | 'status'>,
    today: string,
  ): EmployeeProfileDto {
    const p = this.get(who.userId);
    return {
      ...who,
      ...this.summary(who.userId, today),
      workPhone: p.workPhone,
      version: p.version,
    };
  }

  /** `undefined` = giữ nguyên, `null` = xóa. */
  set(userId: string, fields: Fields): void {
    const p = this.get(userId);
    const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    this.rows.set(userId, { ...p, ...defined, version: p.version + 1 });
  }

  /** Thêm / nhận lại kèm hồ sơ (T-054): không gửi trường nào ⇒ không đụng hồ sơ; `keepHireDate` giữ ngày cũ. */
  applyHire(userId: string, body: HireEmployeeBody): void {
    const { hireDate, department, jobTitle, workPhone, keepHireDate } = body;
    const fields: Fields = { department, jobTitle, workPhone };
    if (!keepHireDate) fields.hireDate = hireDate;
    if (Object.values(fields).some((v) => v !== undefined)) this.set(userId, fields);
  }

  /** Gợi ý phòng ban / chức vụ đã dùng (sắp theo tiếng Việt). */
  suggestions() {
    const pick = (k: 'department' | 'jobTitle') =>
      [...new Set([...this.rows.values()].flatMap((p) => p[k] ?? []))].sort((a, b) =>
        a.localeCompare(b, 'vi'),
      );
    return { departments: pick('department'), jobTitles: pick('jobTitle') };
  }
}
