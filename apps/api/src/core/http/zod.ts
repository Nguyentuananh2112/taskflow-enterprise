import * as z from 'zod';
import { vi } from 'zod/locales';

import { ValidationError, type ValidationIssue } from '../errors';

/** Thông báo lỗi Zod tiếng Việt cho cả API (ADR-081). Gọi một lần lúc khởi động. */
export function configureZodLocale(): void {
  z.config(vi());
}

/**
 * ZodError → `ValidationError`. Chỉ giữ `path`, `code`, `message` — **không** trả `input`
 * hay giá trị nhận được (ADR-096: tránh phản chiếu mật khẩu/token vào response/log).
 */
export function validationErrorFromZod(error: z.ZodError): ValidationError {
  const issues: ValidationIssue[] = error.issues.map((issue) => ({
    path: issue.path.map((segment) => (typeof segment === 'number' ? segment : String(segment))),
    code: issue.code,
    message: issue.message,
  }));
  return new ValidationError(issues);
}
