import {
  IDEMPOTENCY_KEY_HEADER,
  type CancelCorrectionBody,
  type CorrectionParams,
  type DecideCorrectionBody,
  type ListCorrectionsQuery,
  type SubmitCorrectionBody,
} from '@taskflow/contracts';
import type { Request, Response } from 'express';

import type { HttpResponder } from '../../../core/http/envelope';
import { requireUser } from '../../../core/http/request-user';
import type { CorrectionRequestsUseCases } from '../application/use-cases/correction-requests.use-cases';
import type { DecideCorrectionUseCases } from '../application/use-cases/decide-correction.use-cases';

export interface CorrectionControllerDeps {
  requests: CorrectionRequestsUseCases;
  decide: DecideCorrectionUseCases;
  responder: HttpResponder;
}

const meOf = (req: Request) => requireUser(req).id;
const idOf = (req: Request) => (req.params as unknown as CorrectionParams).requestId;

/** Route đơn bổ sung giờ (hr-extended §4, T-056). Quyền / validate ở router; controller chỉ gọi use case. */
export class CorrectionController {
  constructor(private readonly d: CorrectionControllerDeps) {}

  /** 201 đơn mới; lặp cùng Idempotency-Key ⇒ 200 đơn cũ (như check-in). */
  submit = async (req: Request, res: Response) => {
    const { created, dto } = await this.d.requests.submit(
      meOf(req),
      req.body as SubmitCorrectionBody,
      String(req.headers[IDEMPOTENCY_KEY_HEADER]).toLowerCase(),
    );
    if (created) this.d.responder.created(res, dto);
    else this.d.responder.ok(res, dto);
  };

  /** `mine=1` ⇒ đơn của mình; không ⇒ cả công ty (router đã chốt quyền theo `mine`). */
  list = async (req: Request, res: Response) => {
    const { mine, status, cursor, limit } = req.query as unknown as ListCorrectionsQuery;
    const { data, nextCursor } = await this.d.requests.list({
      ...(mine === '1' ? { mineOf: meOf(req) } : {}),
      ...(status ? { status } : {}),
      ...(cursor ? { cursor } : {}),
      limit,
    });
    this.d.responder.ok(res, data, { nextCursor, hasMore: nextCursor !== null, limit });
  };

  cancel = async (req: Request, res: Response) => {
    const { expectedVersion } = req.body as CancelCorrectionBody;
    this.d.responder.ok(
      res,
      await this.d.requests.cancel(meOf(req), { id: idOf(req), expectedVersion }),
    );
  };

  approve = async (req: Request, res: Response) => {
    const body = req.body as DecideCorrectionBody;
    this.d.responder.ok(res, await this.d.decide.approve(meOf(req), { id: idOf(req), ...body }));
  };

  reject = async (req: Request, res: Response) => {
    const body = req.body as DecideCorrectionBody;
    this.d.responder.ok(res, await this.d.decide.reject(meOf(req), { id: idOf(req), ...body }));
  };
}
