import type { APIRequestContext } from '@playwright/test';

import { addDays } from '../../apps/api/test/security/harness/clock';

import { apiLogin } from './api';
import { adaToken } from './company';
import { API_URL, WEB_ORIGIN } from './env';
import { newUser, type E2EUser } from './fixtures';
import { hrCall, vnDate } from './hr';

// Mốc 4 (test-spec-payroll §0.4, §10 E2E-PAY-*) — bảng lương CẢ CÔNG TY, unique (period). Route chép từ harness API
// (`apps/api/test/security/harness/payroll.ts` — file đó import vitest nên Playwright không dùng được). Seed CHỈ qua API
// công khai: Ada (Admin) thêm người kèm `hireDate` (hồ sơ Mốc 5), Kế toán thêm hồ sơ lương + tạo bảng.

export const PAYROLL = {
  salaryProfile: (userId: string) => `/payroll/salary-profiles/${userId}`,
  run: (period: string) => `/payroll/runs/${period}`,
  recalculate: (period: string) => `/payroll/runs/${period}/recalculate`,
  payslip: (period: string, userId: string) => `/payroll/runs/${period}/payslips/${userId}`,
  revisions: (period: string, userId: string) =>
    `/payroll/runs/${period}/payslips/${userId}/revisions`,
  mySlip: (period: string) => `/payslips/${period}`,
  profile: (userId: string) => `/hr/employee-profiles/${userId}`,
} as const;

export type Section = 'INCOME' | 'BONUS' | 'DEDUCTION';
export interface Line {
  section: Section;
  label: string;
  amount: number;
}

export interface RunRow {
  user: { id: string; fullName: string };
  netPay: number;
  blockReasons: string[];
  /** Phiếu của chính người gọi (luật self ⇒ chỉ đọc). */
  own: boolean;
}
export interface Run {
  period: string;
  status: 'DRAFT' | 'PUBLISHED';
  payslips: RunRow[];
}
export interface Payslip {
  userId: string;
  fullName: string;
  companyName: string | null;
  lockVersion: number;
  revision: number;
  lines: (Line & { id: string })[];
  note: string | null;
  netPay: number;
}

/** "7.000.000 ₫" như `formatVnd` của web (NBSP trước ₫). */
export const vnd = (amount: number) =>
  `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(amount)} ₫`;

/** "9/2026" như `monthLabel` của web. */
export const monthLabel = (period: string) => `${Number(period.slice(5, 7))}/${period.slice(0, 4)}`;

/**
 * Kỳ của suite = tháng TRƯỚC "hôm nay" nghiệp vụ (mốc E2E): chỉ tạo bảng cho tháng đã kết thúc, và `startDate` chỉ lùi
 * ≤ 31 ngày (HIRE_BACKDATE_MAX_DAYS) ⇒ không có kỳ nào xa hơn mà người của ca có nhiệm kỳ.
 */
export function suitePeriod(): { period: string; startDate: string } {
  const today = vnDate();
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const lastOfPrev = addDays(firstOfMonth, -1);
  const period = lastOfPrev.slice(0, 7);
  const earliest = addDays(today, -31);
  const first = `${period}-01`;
  return { period, startDate: earliest > first ? earliest : first };
}

/** Phiên API theo người — access TTL E2E 10 s ⇒ đăng nhập lại sau 7 s (như `adaToken`). */
const sessions = new Map<string, { at: number; token: Promise<string> }>();
export function tokenOf(request: APIRequestContext, user: E2EUser): Promise<string> {
  const s = sessions.get(user.email);
  if (s && Date.now() - s.at <= 7_000) return s.token;
  const token = apiLogin(request, user).then((r) => r.accessToken);
  sessions.set(user.email, { at: Date.now(), token });
  token.catch(() => sessions.delete(user.email));
  return token;
}

/** Nhân viên có nhiệm kỳ trong kỳ (`startDate` lùi) + `hireDate` ở hồ sơ, kích hoạt bằng mật khẩu của `user`. */
export async function apiHireForPayroll(
  request: APIRequestContext,
  label: string,
  { startDate, hireDate }: { startDate: string; hireDate: string },
): Promise<E2EUser & { userId: string }> {
  const user = newUser(label);
  const hired = await hrCall<{
    employee: { userId: string };
    activation: { token: string } | null;
  }>(request, 'POST', '/hr/employees', {
    token: await adaToken(request),
    body: { email: user.email, fullName: user.fullName, startDate, hireDate },
    expected: 201,
  });
  if (!hired.activation) throw new Error(`POST /hr/employees ${user.email}: activation null`);
  await hrCall(request, 'POST', '/auth/activate', {
    body: { token: hired.activation.token, password: user.password },
    expected: 200,
  });
  return { ...user, userId: hired.employee.userId };
}

export const apiAddSalaryProfile = async (
  request: APIRequestContext,
  accountant: E2EUser,
  userId: string,
  period: string,
  baseSalary: number,
) =>
  hrCall(request, 'POST', PAYROLL.salaryProfile(userId), {
    token: await tokenOf(request, accountant),
    body: { effectiveFrom: period, level: 'Nhân viên', baseSalary },
    expected: 201,
  });

/** Tạo nháp (idempotent — unique `(period)`: đã có thì server trả bảng sẵn có với 200). */
export async function apiOpenRun(
  request: APIRequestContext,
  accountant: E2EUser,
  period: string,
): Promise<Run> {
  const res = await request.fetch(`${API_URL}${PAYROLL.run(period)}`, {
    method: 'POST',
    headers: {
      origin: WEB_ORIGIN,
      'content-type': 'application/json',
      authorization: `Bearer ${await tokenOf(request, accountant)}`,
    },
    data: '{}',
  });
  if (res.status() !== 201 && res.status() !== 200) {
    throw new Error(
      `POST ${PAYROLL.run(period)} — mong đợi 201/200, nhận ${String(res.status())}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return ((await res.json()) as { data: Run }).data;
}

export const apiRun = async (request: APIRequestContext, accountant: E2EUser, period: string) =>
  hrCall<Run>(request, 'GET', PAYROLL.run(period), {
    token: await tokenOf(request, accountant),
    expected: 200,
  });

export const apiPayslip = async (
  request: APIRequestContext,
  accountant: E2EUser,
  period: string,
  userId: string,
) =>
  hrCall<Payslip>(request, 'GET', PAYROLL.payslip(period, userId), {
    token: await tokenOf(request, accountant),
    expected: 200,
  });

/** PUT phiếu NHÁP theo `lockVersion` hiện hành (đọc ngay trước) — `edit` nhận phiếu, trả lines/note mới. */
export async function apiEditPayslip(
  request: APIRequestContext,
  accountant: E2EUser,
  period: string,
  userId: string,
  edit: (p: Payslip) => { lines: Line[]; note?: string | null },
): Promise<Payslip> {
  const p = await apiPayslip(request, accountant, period, userId);
  const next = edit(p);
  return hrCall<Payslip>(request, 'PUT', PAYROLL.payslip(period, userId), {
    token: await tokenOf(request, accountant),
    body: {
      lines: next.lines,
      note: next.note === undefined ? p.note : next.note,
      overrideHalfDays: null,
      overrideReason: null,
      expectedLockVersion: p.lockVersion,
    },
    expected: 200,
  });
}

export const linesOf = (p: Payslip): Line[] =>
  p.lines.map(({ section, label, amount }) => ({ section, label, amount }));

/**
 * §0.4 (F, 18/10): bảng tháng trước có MỌI nhân viên của lượt E2E có nhiệm kỳ trong kỳ (ca HR lùi `startDate`). Họ
 * thiếu hồ sơ lương / `hireDate` ⇒ PUBLISH_BLOCKED cho cả bảng ⇒ ca phát hành không xanh được. Bổ sung TỐI THIỂU cho
 * người KHÔNG do suite tạo: hồ sơ lương (bảng `salary_profiles` — ca HR không đọc) và `hireDate` chỉ khi đang THIẾU
 * hoặc sau kỳ, rồi "Tính lại công". Chạy ở beforeAll khi lane HR (tuần tự) đã xong các file trước.
 *
 * Vì sao là NGOẠI LỆ của §0.4 ("chỉ sửa người do ca tạo" — F + TL duyệt 18/10): bảng lương là MỘT kỳ cho cả công ty
 * và PUBLISH_BLOCKED chặn CẢ bảng ⇒ không có cách nào khác để phát hành thật. Giới hạn để không vỡ ca HR chạy song
 * song trên CI (firefox-hr / mobile-hr): chỉ PUT `hireDate` khi server báo thiếu / sau kỳ — người đã có `hireDate`
 * hợp lệ (hồ sơ version > 0) KHÔNG bị chạm; bỏ qua dòng `own` (luật self của Kế toán ⇒ 403).
 */
export async function apiUnblockOthers(
  request: APIRequestContext,
  accountant: E2EUser,
  period: string,
  mine: ReadonlySet<string>,
): Promise<Run> {
  const run = await apiRun(request, accountant, period);
  const others = run.payslips.filter(
    (r) => !mine.has(r.user.id) && !r.own && r.blockReasons.length > 0,
  );
  for (const row of others) {
    if (row.blockReasons.includes('MISSING_SALARY_PROFILE')) {
      await apiAddSalaryProfile(request, accountant, row.user.id, period, 5_000_000);
    }
    if (row.blockReasons.some((b) => b === 'MISSING_HIRE_DATE' || b === 'HIRE_DATE_AFTER_PERIOD')) {
      const token = await adaToken(request);
      const profile = await hrCall<{ hireDate: string | null; version: number }>(
        request,
        'GET',
        PAYROLL.profile(row.user.id),
        { token, expected: 200 },
      );
      await hrCall(request, 'PUT', PAYROLL.profile(row.user.id), {
        token,
        body: {
          hireDate: `${period}-01`,
          expectedVersion: profile.version,
          ...(profile.hireDate ? { reason: 'E2E-PAY: ngày vào trước kỳ lương' } : {}),
        },
        expected: 200,
      });
    }
  }
  if (others.length === 0) return run;
  return hrCall<Run>(request, 'POST', PAYROLL.recalculate(period), {
    token: await tokenOf(request, accountant),
    expected: 200,
  });
}
