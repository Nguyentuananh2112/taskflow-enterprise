import * as z from 'zod';

/**
 * Bật thông điệp lỗi tiếng Việt của Zod (ADR-081). Gọi MỘT lần ở composition root của API/web —
 * contracts không tự gọi khi import (không có side effect lúc nạp module).
 */
export function applyVietnameseZodLocale(): void {
  z.config(z.locales.vi());
}

/** Chuyển issue của Zod sang dạng trả client: chỉ path/code/message, bỏ `input` (ADR-096). */
export function toValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
    code: issue.code,
    message: issue.message,
  }));
}
