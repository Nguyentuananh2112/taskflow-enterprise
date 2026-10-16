import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  IDEMPOTENCY_KEY_HEADER,
  type AdjustAttendanceBody,
  type AttendanceCompanyMonthQuery,
  type AttendanceEventsQuery,
  type AttendanceMonthQuery,
  type CreateWorkScheduleBody,
  type DeleteHolidayBody,
  type HolidayListQuery,
  type MyAttendanceEventsQuery,
  type PutHolidayBody,
  type VoidAttendanceBody,
} from '@taskflow/contracts';
import type { Request, Response } from 'express';

import type { HttpResponder } from '../../../core/http/envelope';
import { requireUser } from '../../../core/http/request-user';
import type { AttendanceEventsUseCases } from '../application/use-cases/attendance-events.use-cases';
import type { AttendanceExportUseCase } from '../application/use-cases/attendance-export.use-case';
import type { CheckInOutUseCase } from '../application/use-cases/check-in-out.use-case';
import type { HrAttendanceQueries } from '../application/use-cases/hr-attendance.queries';
import type { MyAttendanceQueries } from '../application/use-cases/my-attendance.queries';
import type { WorkCalendarUseCases } from '../application/use-cases/work-calendar.use-cases';

export interface AttendanceControllerDeps {
  checkInOut: CheckInOutUseCase;
  mine: MyAttendanceQueries;
  hr: HrAttendanceQueries;
  events: AttendanceEventsUseCases;
  calendar: WorkCalendarUseCases;
  exporter: AttendanceExportUseCase;
  responder: HttpResponder;
}

const wsOf = (req: Request) => (req.params as { wsId: string }).wsId;
const meOf = (req: Request) => requireUser(req).id;

/** Route chấm công (thiết kế §5). Kiểm quyền / validate ở router; controller chỉ gọi use case. */
export class AttendanceController {
  constructor(private readonly d: AttendanceControllerDeps) {}

  // ---------- của chính nhân viên (`attendance:self`) ----------

  meToday = async (req: Request, res: Response) => {
    this.d.responder.ok(
      res,
      await this.d.mine.today({ workspaceId: wsOf(req), userId: meOf(req) }),
    );
  };

  meMonth = async (req: Request, res: Response) => {
    const { month } = req.query as unknown as AttendanceMonthQuery;
    this.d.responder.ok(
      res,
      await this.d.mine.month({ workspaceId: wsOf(req), userId: meOf(req), month }),
    );
  };

  meEvents = async (req: Request, res: Response) => {
    const { date } = req.query as unknown as MyAttendanceEventsQuery;
    this.d.responder.ok(
      res,
      await this.d.events.listMine({ workspaceId: wsOf(req), userId: meOf(req), date }),
    );
  };

  checkIn = (req: Request, res: Response) => this.#punch(req, res, 'IN');
  checkOut = (req: Request, res: Response) => this.#punch(req, res, 'OUT');

  /** 201 khi ghi lượt mới; lặp lại cùng Idempotency-Key ⇒ 200 + thẻ hiện tại (AT-03). */
  async #punch(req: Request, res: Response, kind: 'IN' | 'OUT') {
    const { card, replayed } = await this.d.checkInOut.execute({
      workspaceId: wsOf(req),
      userId: meOf(req),
      kind,
      idempotencyKey: String(req.headers[IDEMPOTENCY_KEY_HEADER]).toLowerCase(),
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    if (replayed) this.d.responder.ok(res, card);
    else this.d.responder.created(res, card);
  }

  // ---------- HR (`hr:manage`) ----------

  companyToday = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.hr.today(wsOf(req)));
  };

  companyMonth = async (req: Request, res: Response) => {
    const query = req.query as unknown as AttendanceCompanyMonthQuery;
    const { data, page } = await this.d.hr.month(wsOf(req), query);
    this.d.responder.ok(res, data, page);
  };

  /** CSV stream: quyền + audit EXPORT xong TRƯỚC khi gửi header (lỗi lúc đó vẫn trả envelope JSON). */
  exportCsv = async (req: Request, res: Response) => {
    const { month } = req.query as unknown as AttendanceMonthQuery;
    const { lines } = await this.d.exporter.start(wsOf(req), meOf(req), month);
    res.status(200).set({
      'Content-Type': 'text/csv; charset=utf-8',
      // `month` đã qua YearMonth (YYYY-MM) ⇒ tên file không chèn được gì (SEC-HR-12).
      'Content-Disposition': `attachment; filename="cham-cong-${month}.csv"`,
    });
    await pipeline(Readable.from(lines), res);
  };

  listEvents = async (req: Request, res: Response) => {
    const { userId, date } = req.query as unknown as AttendanceEventsQuery;
    this.d.responder.ok(
      res,
      await this.d.events.listForHr({ workspaceId: wsOf(req), userId, date }),
    );
  };

  adjust = async (req: Request, res: Response) => {
    const body = req.body as AdjustAttendanceBody;
    this.d.responder.created(res, await this.d.events.adjust(wsOf(req), meOf(req), body));
  };

  voidEvent = async (req: Request, res: Response) => {
    const { eventId } = req.params as { eventId: string };
    const { reason } = req.body as VoidAttendanceBody;
    this.d.responder.ok(
      res,
      await this.d.events.void(wsOf(req), meOf(req), { id: eventId, reason }),
    );
  };

  // ---------- lịch + ngày lễ (đọc: mọi thành viên; ghi: `hr:manage`) ----------

  listSchedules = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.calendar.listSchedules(wsOf(req)));
  };

  createSchedule = async (req: Request, res: Response) => {
    const body = req.body as CreateWorkScheduleBody;
    this.d.responder.created(res, await this.d.calendar.createSchedule(wsOf(req), meOf(req), body));
  };

  listHolidays = async (req: Request, res: Response) => {
    const { year } = req.query as unknown as HolidayListQuery;
    this.d.responder.ok(res, await this.d.calendar.listHolidays(wsOf(req), year));
  };

  putHoliday = async (req: Request, res: Response) => {
    const { date } = req.params as { date: string };
    const body = req.body as PutHolidayBody;
    this.d.responder.ok(res, await this.d.calendar.putHoliday(wsOf(req), meOf(req), date, body));
  };

  deleteHoliday = async (req: Request, res: Response) => {
    const { date } = req.params as { date: string };
    const { reason } = req.body as DeleteHolidayBody;
    await this.d.calendar.deleteHoliday(wsOf(req), meOf(req), date, reason);
    res.status(204).end();
  };
}
