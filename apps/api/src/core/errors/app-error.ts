import type { ErrorCode } from '@taskflow/contracts';

/**
 * `error.code` lấy từ contracts (data-and-api.md §3.2) — một nguồn duy nhất cho FE/BE.
 * Import **type-only**: bị xóa khi biên dịch ⇒ domain (ném AppError) không phụ thuộc contracts
 * lúc chạy (ADR-043). Thêm code ⇒ sửa contracts + thêm lớp lỗi; test parity giữ hai bên khớp.
 */
export type { ErrorCode };

export type ErrorDetails = Readonly<Record<string, unknown>> | null;

/**
 * Gốc của mọi lỗi có chủ đích. Mỗi lớp con tự mang `statusCode` + `code` (polymorphism —
 * error handler không rẽ nhánh theo loại lỗi). `message` là tiếng Việt cho người đọc;
 * FE chỉ rẽ nhánh theo `code` (+ `details.rule`).
 *
 * Không phụ thuộc HTTP framework/Zod/contracts ⇒ domain được phép ném (ADR-004, ADR-043).
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: ErrorCode;
  readonly details: ErrorDetails;

  protected constructor(message: string, details: ErrorDetails = null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.details = details;
  }

  /** Header HTTP đi kèm (vd `Retry-After`). Mặc định không có. */
  get headers(): Readonly<Record<string, string>> {
    return {};
  }
}
