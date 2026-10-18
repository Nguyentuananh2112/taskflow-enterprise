import * as z from 'zod';

import { UserRefDto } from '../auth/auth.schemas';
import { DateOnly, IsoDateTime, multiLineTextOrNull, Uuid } from '../common/primitives';

// Chính sách phép (T-057, hr-extended.md ADR-131; người dùng duyệt Mốc 5). Số ngày là thập phân bước 0,5 (server
// đếm bằng số nguyên nửa ngày). Mặc định = mức luật (Đ.113 k.1: 12 ngày; Đ.114: đủ 5 năm ⇒ +1); không cho thấp hơn.

const Year = z.coerce.number().int().min(2000).max(2100);
const halfStep = (min: number, max: number) => z.number().multipleOf(0.5).min(min).max(max);

/** Các trường HR sửa được — cùng giới hạn với CHECK của migration 9. */
export const LeavePolicyFields = z.strictObject({
  /** Phép năm cơ bản: 12 (luật) … 30. */
  annualDays: halfStep(12, 30),
  /** Cứ đủ bao nhiêu năm làm việc thì cộng thêm (luật: 5). */
  seniorityStepYears: z.int().min(1).max(5),
  /** Số ngày cộng mỗi bậc thâm niên (luật: 1). */
  seniorityBonusDays: halfStep(1, 5),
  carryOverEnabled: z.boolean(),
  /** Trần số ngày chuyển sang năm sau. */
  carryOverMaxDays: halfStep(0, 30),
  /** Phép chuyển sang dùng được tới HẾT tháng này của năm sau (mặc định 3 ⇒ hết 31/03). */
  carryOverExpiryMonth: z.int().min(1).max(12),
});
export type LeavePolicyFields = z.infer<typeof LeavePolicyFields>;

/** Mặc định khi chưa năm nào có dòng — để web dựng form, server giữ bản gốc của mình. */
export const LEAVE_POLICY_DEFAULTS: LeavePolicyFields = {
  annualDays: 12,
  seniorityStepYears: 5,
  seniorityBonusDays: 1,
  carryOverEnabled: false,
  carryOverMaxDays: 0,
  carryOverExpiryMonth: 3,
};

/** `GET leave/policy?year=` (hr:manage). */
export const LeavePolicyQuery = z.strictObject({ year: Year });
export type LeavePolicyQuery = z.infer<typeof LeavePolicyQuery>;

export const LeavePolicyParams = z.object({ year: Year });
export type LeavePolicyParams = z.infer<typeof LeavePolicyParams>;

export const LeavePolicyDto = LeavePolicyFields.extend({
  year: z.int(),
  /**
   * `SET` = năm này có dòng riêng; `INHERITED` = lấy dòng gần nhất trước đó (`inheritedFromYear`); `DEFAULT` = chưa
   * năm nào có dòng ⇒ mức luật.
   */
  source: z.enum(['SET', 'INHERITED', 'DEFAULT']),
  inheritedFromYear: z.int().nullable(),
  /** `version` của dòng năm này; 0 khi chưa có dòng (PUT đầu tiên gửi `expectedVersion: 0`). */
  version: z.int().min(0),
  /** HR sửa được năm hiện tại và năm sau; năm đã qua chỉ đọc (422 `POLICY_YEAR_LOCKED`). */
  editable: z.boolean(),
  updatedAt: IsoDateTime.nullable(),
  updatedBy: UserRefDto.nullable(),
});
export type LeavePolicyDto = z.infer<typeof LeavePolicyDto>;

/** `PUT leave/policy/:year` — đủ mọi trường (thay cả bộ), `expectedVersion` = 0 khi tạo dòng mới. */
export const PutLeavePolicyBody = LeavePolicyFields.extend({
  expectedVersion: z.int().min(0),
  /** Lý do quản trị — vào audit `POLICY_SET` (`after.note`). */
  reason: multiLineTextOrNull(500).optional(),
});
export type PutLeavePolicyBody = z.infer<typeof PutLeavePolicyBody>;

/** Nhân viên có số phép còn lại < 0 theo chính sách MỚI — web cảnh báo, server không tự thu hồi đơn. */
export const NegativeBalanceDto = z.object({
  userId: Uuid,
  user: UserRefDto,
  remainingDays: z.number(),
});
export type NegativeBalanceDto = z.infer<typeof NegativeBalanceDto>;

export const PutLeavePolicyResponse = z.object({
  policy: LeavePolicyDto,
  negativeBalances: z.array(NegativeBalanceDto),
});
export type PutLeavePolicyResponse = z.infer<typeof PutLeavePolicyResponse>;

/**
 * Phân rã số phép (thêm vào `LeaveBalanceDto`, giữ trường cũ — ADR-131). Công thức còn lại:
 * `entitled + adjustment − max(0, usedEarly − carriedOver) − usedLate + (hôm nay ≤ carriedExpiresOn ?
 * carriedUsable : 0)` — `carriedUsable` = phần phép chuyển sang CHƯA dùng và còn hạn.
 */
export const LeaveBalanceBreakdown = z.object({
  /** `annualDays + seniorityBonusDays` của năm (trước ghi đè). */
  baseDays: z.number().min(0),
  seniorityBonusDays: z.number().min(0),
  /** Số năm tròn tính tới 31/12 của năm; null khi chưa có ngày vào công ty. */
  seniorityYears: z.int().min(0).nullable(),
  /** `entitledDays` theo chính sách (`POLICY`) hay ghi đè cố định trên dòng số dư (`OVERRIDE`). */
  entitledSource: z.enum(['POLICY', 'OVERRIDE']),
  /** Chưa có ngày vào công ty ⇒ không tính thâm niên; web hiện "Thiếu ngày vào công ty". */
  missingHireDate: z.boolean(),
  carriedOverDays: z.number().min(0),
  /** false ⇒ chưa chụp (tính tạm khi đọc — "(tạm tính)"). */
  carriedFinal: z.boolean(),
  /** Hạn dùng phép chuyển sang (cuối tháng `carryOverExpiryMonth`); null khi không có phép chuyển sang. */
  carriedExpiresOn: DateOnly.nullable(),
  carriedUsableDays: z.number().min(0),
});
export type LeaveBalanceBreakdown = z.infer<typeof LeaveBalanceBreakdown>;

/**
 * `GET leave/export.xlsx?year=&from=&to=` (hr:manage) — `from`/`to` mặc định cả năm, phải nằm trong `year`,
 * `from ≤ to` (400 khi sai).
 */
export const LeaveExportQuery = z
  .strictObject({ year: Year, from: DateOnly.optional(), to: DateOnly.optional() })
  .superRefine((q, ctx) => {
    for (const key of ['from', 'to'] as const) {
      const value = q[key];
      if (value !== undefined && !value.startsWith(`${String(q.year)}-`)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Ngày phải nằm trong năm đã chọn.' });
      }
    }
    if (q.from !== undefined && q.to !== undefined && q.from > q.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Ngày kết thúc phải từ ngày bắt đầu.',
      });
    }
  });
export type LeaveExportQuery = z.infer<typeof LeaveExportQuery>;
