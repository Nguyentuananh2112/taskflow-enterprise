import { toValidationIssues } from '@taskflow/contracts';
import type * as z from 'zod';

import { ValidationError } from '../errors';

/**
 * ZodError → `ValidationError` bằng `toValidationIssues` của contracts: chỉ `path`, `code`,
 * `message` — **không** trả `input` (ADR-096). Locale tiếng Việt (ADR-081): composition root gọi
 * `applyVietnameseZodLocale()` của contracts một lần lúc khởi động.
 */
export function validationErrorFromZod(error: z.ZodError): ValidationError {
  return new ValidationError(toValidationIssues(error));
}
