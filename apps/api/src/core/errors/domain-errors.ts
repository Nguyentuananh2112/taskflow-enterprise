import { AppError, type ErrorCode } from './app-error';

/** 409 — gốc của các xung đột trạng thái. */
export abstract class ConflictError extends AppError {
  readonly statusCode = 409;
}

/** 409 — `expectedVersion` lệch (ADR-010). `current` là DTO mới nhất để FE hòa giải. */
export class VersionConflictError extends ConflictError {
  readonly code: ErrorCode = 'VERSION_CONFLICT';

  constructor(
    currentVersion: number,
    current: unknown = null,
    message = 'Dữ liệu đã bị người khác cập nhật.',
  ) {
    super(message, { currentVersion, current });
  }
}

/** 409 — trùng unique (slug, keyPrefix, đã là thành viên…), trùng rank sau retry. */
export class ResourceConflictError extends ConflictError {
  readonly code: ErrorCode = 'RESOURCE_CONFLICT';

  constructor(
    conflict: { reason: string; field?: string },
    message = 'Dữ liệu bị trùng với bản ghi khác.',
  ) {
    super(message, conflict);
  }
}

export class EmailAlreadyExistsError extends ConflictError {
  readonly code: ErrorCode = 'EMAIL_ALREADY_EXISTS';

  constructor(message = 'Email đã được sử dụng.') {
    super(message);
  }
}

/** 409 — refresh token vừa xoay < 10s (2 tab refresh cùng lúc). */
export class RefreshInProgressError extends ConflictError {
  readonly code: ErrorCode = 'REFRESH_IN_PROGRESS';

  constructor(message = 'Phiên đang được làm mới, vui lòng thử lại.') {
    super(message);
  }
}

/** 422 — vi phạm luật nghiệp vụ. `rule` để FE xử lý theo máy (`LAST_OWNER`, `ASSIGNEE_NOT_MEMBER`…). */
export class BusinessRuleViolationError extends AppError {
  readonly statusCode = 422;
  readonly code: ErrorCode = 'BUSINESS_RULE_VIOLATION';

  constructor(
    rule: string,
    message = 'Thao tác vi phạm quy tắc nghiệp vụ.',
    extra: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, { ...extra, rule });
  }
}

export class InvalidStatusTransitionError extends AppError {
  readonly statusCode = 422;
  readonly code: ErrorCode = 'INVALID_STATUS_TRANSITION';

  constructor(
    transition: { from: string; to: string; allowed: readonly string[] },
    message = 'Không thể chuyển sang trạng thái này.',
  ) {
    super(message, transition);
  }
}

export class ProjectArchivedError extends AppError {
  readonly statusCode = 422;
  readonly code: ErrorCode = 'PROJECT_ARCHIVED';

  constructor(projectId: string, message = 'Dự án đã được lưu trữ, không thể thay đổi.') {
    super(message, { projectId });
  }
}
