import type { Response } from 'express';

import { requestContext } from '../context/request-context';
import type { IClock } from '../domain';
import type { AppError } from '../errors';

/** `meta.page` cho endpoint danh sách — phân trang cursor (data-and-api.md §3.1). */
export interface PageMeta {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

export interface ResponseMeta {
  timestamp: string;
  requestId: string | null;
  page?: PageMeta;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; details: unknown };
  meta: ResponseMeta;
}

/** Dựng envelope chuẩn. Controller chỉ gọi `ok`/`created` — không tự viết `{ success: true }`. */
export class HttpResponder {
  constructor(private readonly clock: IClock) {}

  meta(page?: PageMeta): ResponseMeta {
    return {
      timestamp: this.clock.now().toISOString(),
      requestId: requestContext.requestId() ?? null,
      ...(page ? { page } : {}),
    };
  }

  ok<T>(res: Response, data: T, page?: PageMeta): void {
    this.#send(res, 200, data, page);
  }

  created<T>(res: Response, data: T): void {
    this.#send(res, 201, data);
  }

  errorBody(error: AppError): ErrorEnvelope {
    return {
      success: false,
      error: { code: error.code, message: error.message, details: error.details },
      meta: this.meta(),
    };
  }

  #send<T>(res: Response, status: number, data: T, page?: PageMeta): void {
    const body: SuccessEnvelope<T> = { success: true, data, meta: this.meta(page) };
    res.status(status).json(body);
  }
}
