import { countLeaveHalfDays, type CalendarDate } from '../../domain/leave-days';
import { offboardCleanupPlan } from '../../domain/leave-tenure';
import { auditView, countingTenure, yearOf, type LeaveKit } from '../leave-kit';
import type { ILeaveReadModel } from '../ports/leave-read-model.port';
import { halfDaysToDecimal } from '../../domain/leave-balance';
import type { LeaveRequestRecord } from '../ports/leave.ports';

/** Ghi chú hệ thống trên đơn bị dọn khi nghỉ việc / nâng Admin (company-level ADR-137 bước 4). */
export const OFFBOARD_NOTE = 'Nghỉ việc — hệ thống';
export const REHIRE_NOTE = 'Nhận lại — đặt lại điều chỉnh';

/**
 * Port leave cho vòng đời nhân viên của company (T-062 — `IOffboardLeavePort` do company sở hữu, adapter ở đây). Cả
 * hai lệnh chạy TRONG transaction của bên gọi (`uow.run` lồng nhau dùng chung transaction) và lấy
 * `taskflow:leave-policy` SHARED (bậc 1) rồi `taskflow:leave:<user>` (bậc 3 bảng khóa ADR-136 — bên gọi đã giữ
 * `taskflow:company:admins` bậc 2 nếu cần).
 * Bên gọi PHẢI lấy `taskflow:leave:<user>` TRƯỚC khi DELETE/UPDATE dòng `company_members` (bậc 5) — nếu không sẽ
 * deadlock với submit đang giữ khóa này và chờ FOR SHARE dòng đó; khóa advisory xact tái nhập nên gọi lại vô hại.
 */
export class EmploymentLeaveHooks {
  constructor(
    private readonly kit: LeaveKit,
    private readonly readModel: Pick<ILeaveReadModel, 'findBalance'>,
  ) {}

  /**
   * T-054 PUT hồ sơ (ADR-128/131): nếu `hireDate` của người này đổi thành giá trị mới thì năm HIỆN TẠI và năm SAU còn
   * lại bao nhiêu — chỉ trả năm `< 0`. CHỈ ĐỌC (không tạo dòng số dư); bên gọi đã giữ policy SHARED rồi leave:<user>.
   */
  async negativeBalancesIfHireDate(input: {
    userId: string;
    hireDate: CalendarDate | null;
  }): Promise<{ year: number; remainingDays: number }[]> {
    const today = await this.kit.today();
    const current = yearOf(today);
    const hireDates = {
      hireDateOf: (userId: string) =>
        userId === input.userId
          ? Promise.resolve(input.hireDate)
          : this.kit.d.hireDates.hireDateOf(userId),
    };
    const calc = this.kit.readCalculator(this.readModel, hireDates);
    const tenure = countingTenure(await this.kit.d.company.employmentOf(input.userId));
    const out: { year: number; remainingDays: number }[] = [];
    for (const year of [current, current + 1]) {
      const view = await calc.compute({ userId: input.userId, year, today, tenure });
      if (view.balance.remaining < 0) {
        out.push({ year, remainingDays: halfDaysToDecimal(view.balance.remaining) });
      }
    }
    return out;
  }

  /**
   * HÀNH ĐỘNG HỆ THỐNG khi hoàn tất nghỉ việc / nâng EMPLOYEE→ADMIN (D H1) — không qua bảng chuyển của người dùng:
   * mọi PENDING ⇒ CANCELLED; APPROVED bắt đầu sau `lastDay` ⇒ REVOKED (kể cả đã qua ngày bắt đầu); vắt qua giữ.
   * `decidedBy` = người lên lịch nghỉ (`actorId`), ghi chú hệ thống, audit từng đơn, **một** thông báo tổng cho HR.
   */
  async offboardCleanup(input: {
    userId: string;
    lastDay: CalendarDate;
    actorId: string;
  }): Promise<{ cancelled: number; revoked: number }> {
    const d = this.kit.d;
    return d.uow.run(async () => {
      await this.kit.lockFor(input.userId); // policy SHARED → leave:<user> (ADR-131/136)
      const open = await d.requests.listOpen(input.userId);
      const plan = offboardCleanupPlan(open, input.lastDay);
      const byId = new Map(open.map((r) => [r.id, r]));
      const now = d.clock.now();
      for (const step of plan) {
        const record = byId.get(step.id);
        if (!record) continue;
        const next: LeaveRequestRecord = {
          ...record,
          status: step.to,
          decidedBy: input.actorId,
          decidedAt: now,
          decisionNote: OFFBOARD_NOTE,
          version: record.version + 1,
          updatedAt: now,
        };
        const halfDays = countLeaveHalfDays(
          record,
          await this.kit.yearCalendar(yearOf(record.startDate)),
        );
        await this.kit.save(next, record, halfDays);
        await d.audit.record({
          actorId: input.actorId,
          action: step.to === 'REVOKED' ? 'LEAVE_REVOKE' : 'LEAVE_CANCEL',
          targetUserId: input.userId,
          refId: record.id,
          before: auditView(record),
          after: auditView(next),
          note: OFFBOARD_NOTE,
        });
      }
      if (plan.length > 0) {
        await d.notifier.notify({
          type: 'OFFBOARD_CLEANUP',
          requestId: input.userId,
          actorId: input.actorId,
          recipient: { kind: 'hr' },
        });
      }
      return {
        cancelled: plan.filter((s) => s.to === 'CANCELLED').length,
        revoked: plan.filter((s) => s.to === 'REVOKED').length,
      };
    });
  }

  /**
   * Cảnh báo khi HR lên lịch nghỉ việc (T-062 — B): số đơn PENDING (mọi năm) của người đó. Chỉ đọc, KHÔNG khóa — số
   * có thể lệch với lúc hoàn tất (đơn gửi / hủy sau đó); `offboardCleanup` lúc hoàn tất dọn theo dữ liệu khi ấy.
   */
  async pendingCount(userId: string): Promise<number> {
    return (await this.kit.d.requests.listOpen(userId)).filter((r) => r.status === 'PENDING')
      .length;
  }

  /**
   * Nhận lại cùng năm (D H2): `adjustmentDays` năm Y về 0 (audit `BALANCE_ADJUST` có before/after). Không có dòng số
   * dư hoặc đã là 0 ⇒ không ghi gì. Đơn của nhiệm kỳ trước không bị đụng — số dư chỉ đếm đơn từ `start_date` mới.
   */
  async resetOnRehire(input: { userId: string; year: number; actorId: string }): Promise<boolean> {
    const d = this.kit.d;
    return d.uow.run(async () => {
      await this.kit.lockFor(input.userId);
      const before = await d.requests.getOrCreateBalance(input.userId, input.year);
      if (before.adjustment === 0) return false;
      await d.requests.setBalanceAdjustment(input.userId, input.year, 0);
      await d.audit.record({
        actorId: input.actorId,
        action: 'BALANCE_ADJUST',
        targetUserId: input.userId,
        refId: null,
        before: { year: input.year, adjustmentHalfDays: before.adjustment },
        after: { year: input.year, adjustmentHalfDays: 0 },
        note: REHIRE_NOTE,
      });
      return true;
    });
  }
}
