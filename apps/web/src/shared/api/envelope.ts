import {
  ApiError as ApiErrorEnvelope,
  ApiErrorBody,
  ErrorCode,
  apiSuccess,
  type PageMeta,
} from '@taskflow/contracts/common';
import * as z from 'zod';

import { serverClock } from '@/shared/lib/server-clock';

import { ApiError, CLIENT_ERROR_CODES } from './api-error';

// Đọc response của API: envelope thành công / lỗi (data-and-api §3.1) và file tải về. Hàm thuần theo `Response`
// — dùng chung cho mọi transport của http.ts (fetch, XHR upload).

/**
 * Envelope lỗi của contracts nhưng `code` là string bất kỳ (ADR-102): vỏ vẫn parse chặt, chỉ nới
 * enum mã lỗi để web cũ không hỏng khi API mới thêm mã.
 */
const ErrorEnvelopeAnyCode = ApiErrorEnvelope.extend({
  error: ApiErrorBody.extend({ code: z.string().min(1) }),
});

/** File tải về (`download`): tên lấy từ `Content-Disposition`, không có ⇒ `null`. */
export type DownloadResult = { blob: Blob; filename: string | null };

export type ApiResult<T> = { data: T; page: PageMeta | undefined; requestId: string | undefined };

/** RFC 6266: `filename*=UTF-8''…` (tên có dấu) ưu tiên hơn `filename="…"`. */
function filenameOf(headers: Headers): string | null {
  const disposition = headers.get('Content-Disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // %-mã hóa hỏng ⇒ dùng filename= thường
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1] ?? null;
}

export async function parseEnvelope<S extends z.ZodType>(response: Response, schema: S) {
  const headerRequestId = response.headers.get('X-Request-Id') ?? undefined;
  const bad = (cause: unknown) =>
    new ApiError({
      status: response.status,
      code: CLIENT_ERROR_CODES.badResponse,
      message: 'Phản hồi từ máy chủ không hợp lệ.',
      requestId: headerRequestId,
      cause,
    });

  if (response.status === 204) {
    const empty = schema.safeParse(undefined);
    if (!empty.success) throw bad(empty.error);
    return { data: empty.data, page: undefined, requestId: headerRequestId };
  }
  // Envelope theo @taskflow/contracts (data-and-api §3.1): rẽ theo `success`, rồi parse chặt.
  const body: unknown = await response.json().catch((e: unknown) => e);
  const isFailure =
    typeof body === 'object' && body !== null && 'success' in body && body.success === false;
  if (isFailure) {
    const failure = ErrorEnvelopeAnyCode.safeParse(body);
    if (!failure.success) throw bad(failure.error);
    const { code, message, details } = failure.data.error;
    const requestId = failure.data.meta.requestId;
    serverClock.observe(failure.data.meta.timestamp);
    const known = ErrorCode.safeParse(code);
    throw new ApiError({
      status: response.status,
      code: known.success ? known.data : CLIENT_ERROR_CODES.unknown,
      message,
      details,
      requestId,
      ...(known.success ? {} : { serverCode: code }),
    });
  }
  const success = apiSuccess(schema).safeParse(body);
  if (!success.success) throw bad(success.error);
  // Với S generic, TS không suy được khóa `data` của z.object({ data: S }) ⇒ ép về output của S
  // (giá trị đã được chính `schema` parse ở trên).
  const { data, meta } = success.data as { data: z.output<S>; meta: typeof success.data.meta };
  serverClock.observe(meta.timestamp);
  return { data, page: meta.page, requestId: meta.requestId };
}

export /** File (CSV) thành công ⇒ Blob; lỗi vẫn là envelope JSON ⇒ `parse` ném ApiError như mọi request. */
async function readFile(response: Response): Promise<DownloadResult> {
  if (!response.ok) await parseEnvelope(response, z.never());
  return { blob: await response.blob(), filename: filenameOf(response.headers) };
}
