import type { LeaveExportQuery, LeavePolicyQuery, PutLeavePolicyBody } from '@taskflow/contracts';
import type { Request, Response } from 'express';

import { sendXlsx } from '../../../core/export/xlsx/xlsx-response';
import type { ISpreadsheetWriter } from '../../../core/export/xlsx/xlsx-writer';
import type { HttpResponder } from '../../../core/http/envelope';
import { requireUser } from '../../../core/http/request-user';
import type {
  GetLeavePolicyQuery,
  PutLeavePolicyUseCase,
} from '../application/use-cases/leave-policy.use-cases';
import type { LeaveExportUseCase } from '../application/use-cases/leave-export.use-case';

/**
 * `GET leave/policy?year=` · `PUT leave/policy/:year` · `GET leave/export.xlsx` (T-057, ADR-130/131) — tách khỏi
 * LeaveController (max-lines).
 */
export class LeavePolicyController {
  constructor(
    private readonly d: {
      get: Pick<GetLeavePolicyQuery, 'execute'>;
      put: Pick<PutLeavePolicyUseCase, 'execute'>;
      exporter: Pick<LeaveExportUseCase, 'start'>;
      spreadsheet: ISpreadsheetWriter;
      responder: HttpResponder;
    },
  ) {}

  get = async (req: Request, res: Response) => {
    const { year } = req.query as unknown as LeavePolicyQuery;
    this.d.responder.ok(res, await this.d.get.execute({ actorId: requireUser(req).id }, year));
  };

  /** Quyền + audit EXPORT xong trong `start` (lỗi vẫn là JSON); sau đó mới gửi header và stream. */
  exportXlsx = async (req: Request, res: Response) => {
    const query = req.query as unknown as LeaveExportQuery;
    const { year, sheets } = await this.d.exporter.start(requireUser(req).id, query);
    // `year` đã qua Zod (số nguyên 2000–2100) ⇒ tên file an toàn.
    await sendXlsx(res, this.d.spreadsheet, `nghi-phep-${String(year)}.xlsx`, sheets);
  };

  put = async (req: Request, res: Response) => {
    const { year } = req.params as unknown as { year: number };
    const body = req.body as PutLeavePolicyBody;
    this.d.responder.ok(
      res,
      await this.d.put.execute({ actorId: requireUser(req).id }, Number(year), body),
    );
  };
}
