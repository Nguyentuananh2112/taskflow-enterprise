import type { PageMeta } from '@taskflow/contracts';
import * as z from 'zod';

import { decodeCursor, encodeCursor } from '../../../core/http/cursor';
import type { LeaveType } from '../domain/leave-balance';
import {
  countLeaveHalfDays,
  leaveDatesWithin,
  type CalendarDate,
  type LeaveDayPart,
} from '../domain/leave-days';
import type { LeaveStatus } from '../domain/leave-status';
import { toBalanceDto, toLeaveDto, type LeaveBalanceDto, type LeaveRequestDto } from './leave-dto';
import {
  LeaveKit,
  PERMISSION_HR_MANAGE,
  PERMISSION_LEAVE_SELF,
  countingTenure,
  type LeaveCommandDeps,
  type LeaveScope,
} from './leave-kit';
import type {
  ILeaveEmployeeDirectory,
  ILeaveReadModel,
  LeaveListKey,
} from './ports/leave-read-model.port';
import type { LeaveRequestRecord } from './ports/leave.ports';
import { ListBalancesQuery } from './use-cases/list-balances.query';
import { PreviewLeaveQuery, type LeavePreviewDto } from './use-cases/preview-leave.query';
import type { SubmitLeaveInput } from './use-cases/submit-leave.use-case';

export interface LeaveQueryDeps extends LeaveCommandDeps {
  readModel: ILeaveReadModel;
  employees: ILeaveEmployeeDirectory;
}

export interface LeavePage {
  items: LeaveRequestDto[];
  page: PageMeta;
}

export interface LeaveListQuery {
  status?: LeaveStatus | undefined;
  cursor?: string | undefined;
  limit: number;
}

// `kind` gắn cursor với endpoint (UC-LS08): cursor của danh sách HR dùng ở `?mine=1` ⇒ 400 và ngược lại.
const MINE_CURSOR = 'leave-requests:mine';
const HR_CURSOR = 'leave-requests:hr';
const KeySchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

/**
 * Phía đọc leave (CQRS-lite, ADR-015; thiết kế §5). Không khóa, không ghi — kể cả số dư năm chưa có bản ghi
 * (đọc mặc định 12 ngày, bản ghi chỉ tạo khi có lệnh ghi — LB-01). Số ngày tính khi đọc theo lịch (D-H3a).
 */
export class LeaveQueries {
  readonly #kit: LeaveKit;
  readonly #preview: PreviewLeaveQuery;
  readonly #balances: ListBalancesQuery;

  constructor(private readonly d: LeaveQueryDeps) {
    this.#kit = new LeaveKit(d);
    this.#preview = new PreviewLeaveQuery(this.#kit, d.readModel);
    this.#balances = new ListBalancesQuery(this.#kit, d.readModel, d.employees);
  }

  /** `GET leave-requests?mine=1` — chỉ đơn của CHÍNH người gọi (route không nhận `userId` — SEC-HR-03). */
  async listMine(scope: LeaveScope, query: LeaveListQuery): Promise<LeavePage> {
    await this.#kit.requireActor(scope.actorId, PERMISSION_LEAVE_SELF);
    return this.#list({ userId: scope.actorId }, query, MINE_CURSOR);
  }

  /** `GET leave/requests?status=` — HR xem cả công ty (có `reason`: `hr:manage` được đọc — B-H2). */
  async listForHr(scope: LeaveScope, query: LeaveListQuery): Promise<LeavePage> {
    await this.#kit.requireActor(scope.actorId, PERMISSION_HR_MANAGE);
    return this.#list({}, query, HR_CURSOR);
  }

  /** `GET leave-balances/me?year=` */
  async myBalance(scope: LeaveScope, year: number): Promise<LeaveBalanceDto> {
    await this.#kit.requireActor(scope.actorId, PERMISSION_LEAVE_SELF);
    const { actorId } = scope;
    const [employment, today] = await Promise.all([
      this.d.company.employmentOf(actorId),
      this.#kit.today(),
    ]);
    return toBalanceDto(
      await this.#kit.readCalculator(this.d.readModel).compute({
        userId: actorId,
        year,
        today,
        tenure: countingTenure(employment),
      }),
    );
  }

  /** `GET leave-balances?year=` (HR) — mọi nhân viên hiện tại, sắp theo tên. */
  listBalances(scope: LeaveScope, query: { year: number; cursor?: string; limit: number }) {
    return this.#balances.execute(scope, query);
  }

  /** `GET leave-requests/preview` (TL duyệt) — kiểm như submit, không khóa, không ghi. */
  preview(scope: LeaveScope, input: Omit<SubmitLeaveInput, 'reason'>): Promise<LeavePreviewDto> {
    return this.#preview.execute(scope, input);
  }

  /**
   * Adapter cho `ApprovedLeavePort` của attendance (thiết kế §4) — nối ở composition root. Mỗi ngày LỊCH BIỂU của
   * đơn APPROVED trong [from, to]; attendance tự áp lịch / ngày lễ.
   */
  async approvedLeaves(q: {
    userIds?: readonly string[];
    from: CalendarDate;
    to: CalendarDate;
  }): Promise<{ userId: string; date: CalendarDate; part: LeaveDayPart; type: LeaveType }[]> {
    if (q.userIds?.length === 0) return [];
    const approved = await this.d.readModel.listApproved(q);
    return approved.flatMap((r) =>
      leaveDatesWithin(r, q.from, q.to).map((day) => ({ userId: r.userId, type: r.type, ...day })),
    );
  }

  async #list(
    filter: { userId?: string },
    query: LeaveListQuery,
    kind: string,
  ): Promise<LeavePage> {
    const after: LeaveListKey | null = query.cursor
      ? decodeCursor(query.cursor, kind, KeySchema)
      : null;
    const rows = await this.d.readModel.listRequests(
      { ...filter, ...(query.status === undefined ? {} : { status: query.status }) },
      after,
      query.limit + 1,
    );
    const hasMore = rows.length > query.limit;
    const records = hasMore ? rows.slice(0, query.limit) : rows;
    const last = records.at(-1);
    return {
      items: await this.#dtos(records),
      page: {
        nextCursor:
          hasMore && last
            ? encodeCursor(kind, { createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
        hasMore,
        limit: query.limit,
      },
    };
  }

  /** Một lần gọi lịch (phủ mọi đơn của trang) + một lần gọi tên hiển thị — không N+1. */
  async #dtos(records: LeaveRequestRecord[]): Promise<LeaveRequestDto[]> {
    const [first] = records;
    if (!first) return [];
    const from = records.reduce((m, r) => (r.startDate < m ? r.startDate : m), first.startDate);
    const to = records.reduce((m, r) => (r.endDate > m ? r.endDate : m), first.endDate);
    const userIds = new Set(
      records.flatMap((r) => (r.decidedBy ? [r.userId, r.decidedBy] : [r.userId])),
    );
    const [calendar, refs] = await Promise.all([
      this.d.calendar.workingDays({ from, to }),
      this.d.users.findRefs([...userIds]),
    ]);
    return records.map((r) =>
      toLeaveDto(r, countLeaveHalfDays(r, calendar), refs, { includeReason: true }),
    );
  }
}
