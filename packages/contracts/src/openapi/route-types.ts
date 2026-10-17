import type * as z from 'zod';

import type { ErrorCode } from '../common/error-codes';

// Kiểu của danh mục route OpenAPI — tách riêng để `routes.ts` và danh mục theo mốc (`chat-routes.ts`) cùng import
// mà không vòng phụ thuộc.

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type Security = 'bearer' | 'refreshCookie' | 'none';
export type Tag =
  | 'auth'
  | 'workspaces'
  | 'members'
  | 'projects'
  | 'tasks'
  | 'hr'
  | 'company'
  | 'notifications'
  | 'chat';

export interface ApiRoute {
  method: HttpMethod;
  /** Tương đối `/api/v1`, tham số dạng `{wsId}` (OpenAPI). */
  path: string;
  summary: string;
  tag: Tag;
  security: Security;
  params?: z.ZodObject;
  query?: z.ZodType;
  body?: z.ZodType;
  /** Header bắt buộc (vd `Idempotency-Key`) ⇒ `parameter` `in: header`. */
  headers?: z.ZodObject;
  /** Mốc 6 (ADR-141): thân NHỊ PHÂN `application/octet-stream` (upload) thay cho JSON. */
  binaryBody?: true;
  /**
   * 204 ⇒ không body; còn lại `data` của envelope; `paged` ⇒ có `meta.page`; `csv` ⇒ thân `text/csv` (không
   * envelope); `alsoOk` ⇒ lặp lại idempotent trả 200 cùng `data` (check-in cùng Idempotency-Key).
   */
  response: {
    status: 200 | 201 | 204;
    data?: z.ZodType;
    paged?: boolean;
    csv?: boolean;
    alsoOk?: boolean;
  };
  /** Mã lỗi đặc thù của route (ngoài lỗi chung 400/401/403/404/429). */
  errors?: readonly ErrorCode[];
}
