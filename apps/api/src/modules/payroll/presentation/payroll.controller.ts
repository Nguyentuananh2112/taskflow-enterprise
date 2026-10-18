import type {
  CreatePayslipRevisionBody,
  CreateSalaryProfileVersionBody,
  MyPayslipRevisionParams,
  PayrollPeriodParams,
  PayslipParams,
  PutPayrollSettingsBody,
  PutPayslipBody,
  SalaryProfileParams,
} from '@taskflow/contracts/payroll';
import type { Request, Response } from 'express';

import { sendXlsx } from '../../../core/export/xlsx/xlsx-response';
import type { ISpreadsheetWriter } from '../../../core/export/xlsx/xlsx-writer';
import type { HttpResponder } from '../../../core/http/envelope';
import { requireUser } from '../../../core/http/request-user';
import { payslipDto } from '../application/payroll-dto';
import type { PayrollExportUseCase } from '../application/use-cases/payroll-export.use-case';
import type { PayrollRunsUseCases } from '../application/use-cases/payroll-runs.use-cases';
import type { PayrollQueries } from '../application/use-cases/payroll.queries';
import type { PayslipEditsUseCases } from '../application/use-cases/payslip-edits.use-cases';
import type { PublishPayrollUseCase } from '../application/use-cases/publish-payroll.use-case';
import type { SettingsProfilesUseCases } from '../application/use-cases/settings-profiles.use-cases';
import type { IPayrollStore } from '../application/ports/payroll-store.port';

export interface PayrollControllerDeps {
  settings: SettingsProfilesUseCases;
  runs: PayrollRunsUseCases;
  publish: PublishPayrollUseCase;
  edits: PayslipEditsUseCases;
  queries: PayrollQueries;
  exporter: PayrollExportUseCase;
  writer: ISpreadsheetWriter;
  store: Pick<IPayrollStore, 'findRun'>;
  responder: HttpResponder;
}

const meOf = (req: Request) => requireUser(req).id;
const periodOf = (req: Request) => (req.params as unknown as PayrollPeriodParams).period;

/** Route lương (payroll.md §4). Quyền + validate ở router; controller chỉ gọi use case. Mọi lệnh trả bảng tháng mới. */
export class PayrollController {
  constructor(private readonly d: PayrollControllerDeps) {}

  exportXlsx = async (req: Request, res: Response) => {
    await this.d.exporter.run(meOf(req), periodOf(req), (filename, sheets) =>
      sendXlsx(res, this.d.writer, filename, sheets),
    );
  };

  getSettings = async (_req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.settings.settings());
  };

  putSettings = async (req: Request, res: Response) => {
    this.d.responder.ok(
      res,
      await this.d.settings.putSettings(meOf(req), req.body as PutPayrollSettingsBody),
    );
  };

  listProfiles = async (_req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.settings.profiles());
  };

  createProfile = async (req: Request, res: Response) => {
    const { userId } = req.params as unknown as SalaryProfileParams;
    const body = req.body as CreateSalaryProfileVersionBody;
    this.d.responder.created(
      res,
      await this.d.settings.createVersion(meOf(req), { userId, ...body }),
    );
  };

  listRuns = async (_req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.queries.runs());
  };

  getRun = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.queries.run(meOf(req), periodOf(req)));
  };

  /** 201 bảng mới; đã có ⇒ 200 bảng hiện có (idempotent). */
  createRun = async (req: Request, res: Response) => {
    const { created } = await this.d.runs.create(meOf(req), periodOf(req));
    const dto = await this.d.queries.run(meOf(req), periodOf(req));
    if (created) this.d.responder.created(res, dto);
    else this.d.responder.ok(res, dto);
  };

  previewRecalculate = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.runs.previewRecalculate(meOf(req), periodOf(req)));
  };

  recalculate = async (req: Request, res: Response) => {
    await this.d.runs.recalculate(meOf(req), periodOf(req));
    this.d.responder.ok(res, await this.d.queries.run(meOf(req), periodOf(req)));
  };

  addMissing = async (req: Request, res: Response) => {
    await this.d.runs.addMissing(meOf(req), periodOf(req));
    this.d.responder.ok(res, await this.d.queries.run(meOf(req), periodOf(req)));
  };

  publish = async (req: Request, res: Response) => {
    await this.d.publish.execute(meOf(req), periodOf(req));
    this.d.responder.ok(res, await this.d.queries.run(meOf(req), periodOf(req)));
  };

  getPayslip = async (req: Request, res: Response) => {
    const { period, userId } = req.params as unknown as PayslipParams;
    this.d.responder.ok(res, await this.d.queries.payslip(meOf(req), period, userId));
  };

  putPayslip = async (req: Request, res: Response) => {
    const { period, userId } = req.params as unknown as PayslipParams;
    const saved = await this.d.edits.put(meOf(req), {
      period,
      userId,
      ...(req.body as PutPayslipBody),
    });
    this.d.responder.ok(res, payslipDto((await this.d.store.findRun(period))!, saved));
  };

  revisePayslip = async (req: Request, res: Response) => {
    const { period, userId } = req.params as unknown as PayslipParams;
    const body = req.body as CreatePayslipRevisionBody;
    const saved = await this.d.edits.revise(meOf(req), { period, userId, ...body });
    this.d.responder.created(res, payslipDto((await this.d.store.findRun(period))!, saved));
  };

  // ---------- nhân viên (`payslip:self`) ----------

  myPayslips = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.queries.mine(meOf(req)));
  };

  myPayslip = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.queries.myPayslip(meOf(req), periodOf(req)));
  };

  myPayslipRevision = async (req: Request, res: Response) => {
    const { period, revision } = req.params as unknown as MyPayslipRevisionParams;
    this.d.responder.ok(res, await this.d.queries.myPayslip(meOf(req), period, revision));
  };
}
