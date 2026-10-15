import { ResourceConflictDetails, ValidationErrorDetails } from '@taskflow/contracts/common';

import { isApiError } from '@/shared/api';

// Đổ lỗi server vào form (frontend.md §7.3). Nhận `setError` tối thiểu để shared không phụ thuộc
// kiểu cứng của react-hook-form.

export type SetFieldError = (field: string, error: { type: string; message: string }) => void;

/** Lỗi gốc của form (không gắn field) — react-hook-form đọc ở `errors.root.server`. */
export const ROOT_ERROR = 'root.server';

const GENERIC = 'Có lỗi xảy ra, vui lòng thử lại.';

/**
 * `fieldByCode`: mã lỗi gắn cố định vào một field (vd `EMAIL_ALREADY_EXISTS` → `email`).
 * Issue có `path[0]` không thuộc `fields` ⇒ gộp vào lỗi gốc, không nuốt.
 */
export function applyServerErrors(
  setError: SetFieldError,
  error: unknown,
  opts: Readonly<{
    fields: readonly string[];
    fieldByCode?: Readonly<Record<string, string>>;
    /** `RESOURCE_CONFLICT` có `details.field` thuộc form ⇒ lỗi tại field đó (frontend.md §7.3). */
    conflictMessages?: Readonly<Record<string, string>>;
  }>,
): void {
  if (!isApiError(error)) {
    setError(ROOT_ERROR, { type: 'server', message: GENERIC });
    return;
  }
  const field = opts.fieldByCode?.[error.code];
  if (field) {
    setError(field, { type: error.code, message: error.message });
    return;
  }
  const conflict = ResourceConflictDetails.safeParse(error.details);
  if (error.code === 'RESOURCE_CONFLICT' && conflict.success) {
    const name = conflict.data.field;
    if (name && opts.fields.includes(name)) {
      setError(name, {
        type: error.code,
        message: opts.conflictMessages?.[name] ?? 'Giá trị này đã được sử dụng.',
      });
      return;
    }
  }
  const details = ValidationErrorDetails.safeParse(error.details);
  if (error.code === 'VALIDATION_ERROR' && details.success) {
    const rootMessages: string[] = [];
    for (const issue of details.data.issues) {
      const name = String(issue.path[0] ?? '');
      if (opts.fields.includes(name)) setError(name, { type: issue.code, message: issue.message });
      else rootMessages.push(issue.message);
    }
    if (rootMessages.length > 0) {
      setError(ROOT_ERROR, { type: 'server', message: rootMessages.join(' ') });
    }
    return;
  }
  setError(ROOT_ERROR, { type: error.code, message: messageFor(error) });
}

function messageFor(error: { code: string; message: string; status: number; details: unknown }) {
  if (error.code === 'RATE_LIMITED') {
    const seconds = (error.details as { retryAfterSec?: unknown } | null)?.retryAfterSec;
    return typeof seconds === 'number'
      ? `Bạn thao tác quá nhanh. Thử lại sau ${seconds} giây.`
      : 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.';
  }
  if (error.code === 'NETWORK_ERROR')
    return 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.';
  // Lỗi 5xx/không rõ (gồm UNKNOWN_ERROR — ADR-102): câu chung theo HTTP status, không lộ chi tiết.
  if (error.status >= 500 || error.code === 'UNKNOWN_ERROR' || error.code === 'BAD_RESPONSE') {
    return GENERIC;
  }
  return error.message || GENERIC;
}
