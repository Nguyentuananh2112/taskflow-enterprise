import type { Response } from 'supertest';

import type { PageMeta } from '../../src/core/http/envelope';

/** Hình dạng envelope (data-and-api.md §3.1) để đọc `res.body` có kiểu trong test HTTP. */
export interface EnvelopeBody<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details: {
      issues?: { path: (string | number)[]; code: string; message: string }[];
      debug?: { name?: string; message?: string; stack?: string };
      [key: string]: unknown;
    } | null;
  };
  meta: { timestamp: string; requestId: string | null; page?: PageMeta };
}

export function envelopeOf<T = unknown>(res: Response): EnvelopeBody<T> {
  return res.body as EnvelopeBody<T>;
}

/** `error` của envelope lỗi — ném nếu response không phải lỗi (để test fail rõ ràng). */
export function errorOf(res: Response): NonNullable<EnvelopeBody['error']> {
  const { error } = envelopeOf(res);
  if (!error) throw new Error(`Response ${res.status} không có error: ${JSON.stringify(res.body)}`);
  return error;
}
