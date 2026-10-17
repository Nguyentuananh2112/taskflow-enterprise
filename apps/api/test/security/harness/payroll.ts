import { expect } from 'vitest';

import type { Actors } from './actors';
import { addDays, daysInMonth, nextVnDateAnchor } from './clock';
import type { CompanyActor } from './company';
import { HR, adjust, leaveOf, submitLeave } from './hr';
import type { RawResponse } from './http-client';

/**
 * Harness Mốc 4 — phiếu lương (test-spec-payroll §1.2). Route theo contracts T-048 (B, `feat/T-048-payroll-schema`
 * 3d1e482, `packages/contracts/src/payroll/payroll.schemas.ts`) — ca không lặp chuỗi đường dẫn.
 */
export const PAYROLL = {
  settings: '/payroll/settings',
  salaryProfiles: '/payroll/salary-profiles',
  salaryProfile: (userId: string) => `/payroll/salary-profiles/${userId}`,
  runs: '/payroll/runs',
  /** POST = tạo nháp (idempotent), GET = bảng tháng. */
  run: (period: string) => `/payroll/runs/${period}`,
  recalculatePreview: (period: string) => `/payroll/runs/${period}/recalculate/preview`,
  recalculate: (period: string) => `/payroll/runs/${period}/recalculate`,
  addMissing: (period: string) => `/payroll/runs/${period}/add-missing`,
  publish: (period: string) => `/payroll/runs/${period}/publish`,
  exportXlsx: (period: string) => `/payroll/runs/${period}/export.xlsx`,
  /** GET / PUT (`overrideHalfDays` + `overrideReason` = sửa công). */
  payslip: (period: string, userId: string) => `/payroll/runs/${period}/payslips/${userId}`,
  revisions: (period: string, userId: string) =>
    `/payroll/runs/${period}/payslips/${userId}/revisions`,
  mySlips: '/payslips',
  mySlip: (period: string) => `/payslips/${period}`,
  mySlipRevision: (period: string, revision: number) =>
    `/payslips/${period}/revisions/${String(revision)}`,
} as const;

// ---------------------------------------------------------------- mốc theo kỳ

export interface PayrollMonth {
  /** Kỳ `YYYY-MM`. */
  period: string;
  /** Mốc ngày 1 của kỳ, 10:00 VN — tạo người (`startDate` mặc định = hôm nay = ngày 1), nộp đơn nghỉ trong kỳ. */
  startAnchor: string;
  /** Mốc sau khi kỳ kết thúc (ngày `runDay` tháng sau, 10:00 VN) — `api.restart`, chấm công quá khứ, tạo bảng. */
  runAnchor: string;
  /** Mọi ngày của kỳ. */
  days: string[];
}

/**
 * Một kỳ lương dựng được bằng hộp đen: `startDate` của nhân viên chỉ lùi ≤ 31 ngày (CLK-HR-07), chấm công / HR thêm
 * lượt không được ở tương lai ⇒ (1) API chạy ở `startAnchor` (ngày 1 của kỳ, ≥ hôm nay + 2): tạo người, nộp + duyệt
 * đơn nghỉ trong kỳ; (2) `api.restart({ TEST_CLOCK_ANCHOR: runAnchor })`: HR `adjust` các ngày đã qua, tạo bảng.
 * Kỳ sau trong cùng file: `payrollMonth({ after: prev })`.
 */
export function payrollMonth(opts: { from?: Date; after?: PayrollMonth; runDay?: number } = {}) {
  const runDay = opts.runDay ?? 2;
  const startAnchor = opts.after
    ? nextVnDateAnchor('*-01', '10:00:00', { from: new Date(opts.after.runAnchor) })
    : nextVnDateAnchor('*-01', '10:00:00', opts.from ? { from: opts.from } : {});
  const first = new Date(Date.parse(startAnchor) + 7 * 3_600_000).toISOString().slice(0, 10);
  const period = first.slice(0, 7);
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => addDays(first, i));
  const next = addDays(days.at(-1) as string, runDay);
  const runAnchor = new Date(Date.parse(`${next}T10:00:00+07:00`)).toISOString();
  return { period, startAnchor, runAnchor, days } satisfies PayrollMonth;
}

// ---------------------------------------------------------------- dựng công

/**
 * Kế hoạch một ngày: `P` IN 08:00 + OUT 17:30 · `MO` chỉ IN (MISSING_OUT) · `A` vắng · `{ leave }` đơn nghỉ đã duyệt
 * (`part` mặc định FULL), `present: true` ⇒ có thêm IN + OUT (phép thắng lượt chấm — PD-16).
 */
export type DayPlan =
  | 'P'
  | 'MO'
  | 'A'
  | {
      leave: 'ANNUAL' | 'SICK' | 'PERSONAL_PAID' | 'UNPAID' | 'OTHER';
      part?: 'FULL' | 'AM' | 'PM';
      present?: boolean;
    };

type Who = Pick<CompanyActor, 'accessToken'>;

async function ok(res: RawResponse | Promise<RawResponse>, want: number, what: string) {
  const r = await res;
  expect(r.status, `${what}: ${r.text.slice(0, 300)}`).toBe(want);
  return r;
}

/** Pha 1 (ở `startAnchor`): nhân viên nộp đơn nghỉ trong kỳ, HR duyệt. Trả id đơn theo ngày. */
export async function seedLeaves(
  actors: Actors,
  hr: Who,
  employee: Who,
  plan: Readonly<Record<string, DayPlan>>,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [date, p] of Object.entries(plan)) {
    if (typeof p === 'string') continue;
    const res = await ok(
      submitLeave(actors, employee, {
        type: p.leave,
        startDate: date,
        endDate: date,
        dayPart: p.part ?? 'FULL',
        reason: 'F payroll seed',
      }),
      201,
      `đơn nghỉ ${date}`,
    );
    const leave = leaveOf(res);
    await ok(
      actors.json('POST', HR.leaveAction(leave.id, 'approve'), hr.accessToken, {
        expectedVersion: leave.version,
      }),
      200,
      `duyệt đơn ${date}`,
    );
    ids.set(date, leave.id);
  }
  return ids;
}

/** Pha 2 (sau `api.restart` ở `runAnchor`): HR thêm lượt ADJUSTMENT cho các ngày đã qua. */
export async function seedPunches(
  actors: Actors,
  hr: Who,
  userId: string,
  plan: Readonly<Record<string, DayPlan>>,
): Promise<void> {
  for (const [date, p] of Object.entries(plan)) {
    const present = p === 'P' || p === 'MO' || (typeof p === 'object' && p.present === true);
    if (!present) continue;
    await ok(adjust(actors, hr, userId, 'IN', '08:00', 'F payroll seed', date), 201, `IN ${date}`);
    if (p === 'MO') continue;
    await ok(
      adjust(actors, hr, userId, 'OUT', '17:30', 'F payroll seed', date),
      201,
      `OUT ${date}`,
    );
  }
}

// ---------------------------------------------------------------- không lộ tiền (§0.5)

/** Số tiền đánh dấu duy nhất (7 chữ số, không tròn) — để tìm trong log / thông báo / URL. */
export function moneyMarker(seed: number = Date.now()): number {
  return 7_000_000 + (((seed % 999_983) * 7_919) % 999_983) + 17;
}

const NBSP = String.fromCharCode(0xa0);
const NNBSP = String.fromCharCode(0x202f);

/** Mọi cách viết của một số tiền: `7031117`, `7.031.117`, `7,031,117`, `7 031 117` (cả NBSP / NNBSP). */
export function moneySpellings(amount: number): string[] {
  const raw = String(amount);
  const group = (sep: string) => raw.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return [raw, group('.'), group(','), group(' '), group(NBSP), group(NNBSP)];
}

/** Bất biến §0.5: số đánh dấu không có trong bất kỳ nguồn nào (`name ⇒ nội dung`). */
export function expectNoMoney(amount: number, sources: Readonly<Record<string, unknown>>): void {
  const spellings = moneySpellings(amount);
  for (const [name, value] of Object.entries(sources)) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const s of spellings) {
      // Biên chữ số: `7031117` trong `70311170` (id, timestamp) không phải số tiền.
      const body = s.replace(/[.]/g, '\\.');
      const at = new RegExp(`(?<![\\d.,])${body}(?!\\d|[.,]\\d)`).exec(text);
      expect(at === null, `${name} chứa số tiền ${s}`).toBe(true);
    }
  }
}

// ---------------------------------------------------------------- lỗi phát hành

export interface PublishBlocker {
  userId: string;
  reasons: string[];
}

/** 422 `PUBLISH_BLOCKED` (TL chốt 18/10) ⇒ `details.blockers` đã kiểm dạng + thứ tự `userId`. */
export function publishBlockers(res: RawResponse): PublishBlocker[] {
  expect(res.status, res.text.slice(0, 300)).toBe(422);
  const body = res.json as {
    error?: { code?: string; details?: { rule?: string; blockers?: PublishBlocker[] } };
  };
  expect(body.error?.code).toBe('BUSINESS_RULE_VIOLATION');
  expect(body.error?.details?.rule).toBe('PUBLISH_BLOCKED');
  const blockers = body.error?.details?.blockers ?? [];
  const ids = blockers.map((b) => b.userId);
  expect(ids, 'blockers sắp theo userId').toEqual([...ids].sort());
  for (const b of blockers)
    expect(b.reasons.length, `${b.userId}: reasons rỗng`).toBeGreaterThan(0);
  return blockers;
}
