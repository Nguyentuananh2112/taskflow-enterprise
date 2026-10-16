import type {
  AdjustLeaveBalanceBody,
  CancelLeaveBody,
  DecideLeaveBody,
  LeaveBalanceParams,
  LeaveBalanceQuery,
  LeavePreviewQuery,
  ListLeaveBalancesQuery,
  ListLeaveRequestsQuery,
  RevokeLeaveBody,
  SubmitLeaveBody,
} from '@taskflow/contracts';
import type { Request, Response } from 'express';

import type { HttpResponder } from '../../../core/http/envelope';
import { requireUser } from '../../../core/http/request-user';
import type { LeaveCommands } from '../application/leave-commands';
import type { LeaveScope } from '../application/leave-kit';
import type { LeaveQueries } from '../application/leave-queries';
import { halfDaysFromDecimal } from '../domain/leave-balance';

export interface LeaveControllerDeps {
  commands: LeaveCommands;
  queries: LeaveQueries;
  responder: HttpResponder;
}

const scopeOf = (req: Request): LeaveScope => ({
  workspaceId: (req.params as { wsId: string }).wsId,
  actorId: requireUser(req).id,
});
const requestIdOf = (req: Request) => (req.params as { requestId: string }).requestId;

/** Nghỉ phép (thiết kế §5). Controller chỉ gọi use case / query (ADR-015); quyền + thứ tự lỗi kiểm lại ở use case. */
export class LeaveController {
  constructor(private readonly d: LeaveControllerDeps) {}

  list = async (req: Request, res: Response) => {
    const { mine, status, cursor, limit } = req.query as unknown as ListLeaveRequestsQuery;
    const query = { status, cursor, limit };
    const { items, page } =
      mine === '1'
        ? await this.d.queries.listMine(scopeOf(req), query)
        : await this.d.queries.listForHr(scopeOf(req), query);
    this.d.responder.ok(res, items, page);
  };

  preview = async (req: Request, res: Response) => {
    const query = req.query as unknown as LeavePreviewQuery;
    this.d.responder.ok(res, await this.d.queries.preview(scopeOf(req), query));
  };

  submit = async (req: Request, res: Response) => {
    const body = req.body as SubmitLeaveBody;
    this.d.responder.created(res, await this.d.commands.submit(scopeOf(req), body));
  };

  cancel = async (req: Request, res: Response) => {
    const { expectedVersion } = req.body as CancelLeaveBody;
    this.d.responder.ok(
      res,
      await this.d.commands.cancel(scopeOf(req), requestIdOf(req), expectedVersion),
    );
  };

  approve = async (req: Request, res: Response) => {
    const { expectedVersion, note } = req.body as DecideLeaveBody;
    this.d.responder.ok(
      res,
      await this.d.commands.approve(scopeOf(req), requestIdOf(req), expectedVersion, note ?? null),
    );
  };

  reject = async (req: Request, res: Response) => {
    const { expectedVersion, note } = req.body as DecideLeaveBody;
    this.d.responder.ok(
      res,
      await this.d.commands.reject(scopeOf(req), requestIdOf(req), expectedVersion, note ?? null),
    );
  };

  revoke = async (req: Request, res: Response) => {
    const { expectedVersion, note } = req.body as RevokeLeaveBody;
    this.d.responder.ok(
      res,
      await this.d.commands.revoke(scopeOf(req), requestIdOf(req), expectedVersion, note),
    );
  };

  myBalance = async (req: Request, res: Response) => {
    const { year } = req.query as unknown as LeaveBalanceQuery;
    this.d.responder.ok(res, await this.d.queries.myBalance(scopeOf(req), year));
  };

  listBalances = async (req: Request, res: Response) => {
    const { year, cursor, limit } = req.query as unknown as ListLeaveBalancesQuery;
    const { items, page } = await this.d.queries.listBalances(scopeOf(req), {
      year,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    this.d.responder.ok(res, items, page);
  };

  adjustBalance = async (req: Request, res: Response) => {
    const { userId, year } = req.params as unknown as LeaveBalanceParams;
    const { adjustmentDays, note } = req.body as AdjustLeaveBalanceBody;
    this.d.responder.ok(
      res,
      await this.d.commands.adjustBalance(scopeOf(req), {
        userId,
        year,
        adjustment: halfDaysFromDecimal(adjustmentDays),
        note: note ?? null,
      }),
    );
  };
}
