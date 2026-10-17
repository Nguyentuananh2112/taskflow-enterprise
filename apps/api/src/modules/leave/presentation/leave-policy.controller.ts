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
      exporter: Pick<LeaveExportUseCase, 'run'>;
      spreadsheet: ISpreadsheetWriter;
      responder: HttpResponder;
    },
  ) {}

  get = async (req: Request, res: Response) => {
    const { year } = req.query as unknown as LeavePolicyQuery;
    this.d.responder.ok(res, await this.d.get.execute({ actorId: requireUser(req).id }, year));
  };

  /**
   * Quyền / 429 / 422 / audit EXPORT xảy ra TRƯỚC `deliver` (lỗi lúc đó vẫn là envelope JSON); `deliver` gửi header rồi
   * stream ngay trong snapshot của use case.
   */
  exportXlsx = async (req: Request, res: Response) => {
    const query = req.query as unknown as LeaveExportQuery;
    // `year` đã qua Zod (số nguyên 2000–2100) ⇒ tên file an toàn.
    const filename = `nghi-phep-${String(query.year)}.xlsx`;
    await this.d.exporter.run(requireUser(req).id, query, (sheets) =>
      sendXlsx(res, this.d.spreadsheet, filename, sheets),
    );
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
