import { ErrorCode } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import {
  ActivationGoneError,
  ActivationInvalidError,
  ActiveContentError,
  ImageProcessingBusyError,
  ImageProcessingUnavailableError,
  InvalidUploadNameError,
  SessionRevokedError,
  StorageFullError,
  UnsupportedFileTypeError,
  AppError,
  BusinessRuleViolationError,
  EmailAlreadyExistsError,
  ForbiddenError,
  InternalError,
  InvalidCredentialsError,
  InvalidCurrentPasswordError,
  InvalidStatusTransitionError,
  OriginNotAllowedError,
  PayloadTooLargeError,
  ProjectArchivedError,
  RateLimitedError,
  RefreshInProgressError,
  RefreshTokenInvalidError,
  ResourceConflictError,
  ResourceNotFoundError,
  ServiceUnavailableError,
  TokenExpiredError,
  UnauthorizedError,
  UnsupportedMediaTypeError,
  ValidationError,
  VersionConflictError,
} from './index';

// [lỗi, HTTP, code, details] — một dòng cho mỗi code của data-and-api.md §3.2.
const CATALOG: [AppError, number, string, unknown][] = [
  [
    new ValidationError([{ path: ['title'], code: 'too_small', message: 'm' }]),
    400,
    'VALIDATION_ERROR',
    { issues: [{ path: ['title'], code: 'too_small', message: 'm' }] },
  ],
  [new UnauthorizedError(), 401, 'UNAUTHORIZED', null],
  [new TokenExpiredError(), 401, 'TOKEN_EXPIRED', null],
  [new InvalidCredentialsError(), 401, 'INVALID_CREDENTIALS', null],
  [new InvalidCurrentPasswordError(), 400, 'INVALID_CURRENT_PASSWORD', null],
  [new RefreshTokenInvalidError(), 401, 'REFRESH_TOKEN_INVALID', null],
  [new OriginNotAllowedError(), 403, 'ORIGIN_NOT_ALLOWED', null],
  [new ForbiddenError('task:delete'), 403, 'FORBIDDEN_ACCESS', { required: 'task:delete' }],
  [new ResourceNotFoundError('task'), 404, 'RESOURCE_NOT_FOUND', { resource: 'task' }],
  [
    new VersionConflictError(3, { id: 't' }),
    409,
    'VERSION_CONFLICT',
    { currentVersion: 3, current: { id: 't' } },
  ],
  [
    new ResourceConflictError({ field: 'slug', reason: 'taken' }),
    409,
    'RESOURCE_CONFLICT',
    { field: 'slug', reason: 'taken' },
  ],
  [new EmailAlreadyExistsError(), 409, 'EMAIL_ALREADY_EXISTS', null],
  [new RefreshInProgressError(), 409, 'REFRESH_IN_PROGRESS', null],
  [new PayloadTooLargeError(), 413, 'PAYLOAD_TOO_LARGE', null],
  [new UnsupportedMediaTypeError(), 415, 'UNSUPPORTED_MEDIA_TYPE', null],
  [
    new InvalidStatusTransitionError({ from: 'TODO', to: 'DONE', allowed: ['IN_PROGRESS'] }),
    422,
    'INVALID_STATUS_TRANSITION',
    { from: 'TODO', to: 'DONE', allowed: ['IN_PROGRESS'] },
  ],
  [new ProjectArchivedError('p1'), 422, 'PROJECT_ARCHIVED', { projectId: 'p1' }],
  [
    new BusinessRuleViolationError('LAST_OWNER'),
    422,
    'BUSINESS_RULE_VIOLATION',
    { rule: 'LAST_OWNER' },
  ],
  [new RateLimitedError(30), 429, 'RATE_LIMITED', { retryAfterSec: 30 }],
  [new InternalError(new Error('db exploded')), 500, 'INTERNAL_ERROR', null],
  [new ServiceUnavailableError(), 503, 'SERVICE_UNAVAILABLE', null],
  [new SessionRevokedError(), 401, 'SESSION_REVOKED', null],
  [new ActivationInvalidError(), 400, 'ACTIVATION_INVALID', null],
  [new ActivationGoneError(), 410, 'ACTIVATION_GONE', null],
  // Mốc 6 — kho tệp (ADR-141)
  [new InvalidUploadNameError(), 400, 'INVALID_UPLOAD_NAME', null],
  [new UnsupportedFileTypeError(), 415, 'UNSUPPORTED_FILE_TYPE', null],
  [new ActiveContentError(), 415, 'MACRO_OR_ACTIVE_CONTENT', null],
  [new ImageProcessingBusyError(), 503, 'IMAGE_PROCESSING_BUSY', { retryAfterSec: 5 }],
  [new ImageProcessingUnavailableError(), 503, 'IMAGE_PROCESSING_UNAVAILABLE', null],
  [new StorageFullError(), 507, 'STORAGE_FULL', null],
];

describe('danh mục lỗi (data-and-api.md §3.2)', () => {
  it.each(CATALOG)('%s → HTTP %i, code %s', (error, status, code, details) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(status);
    expect(error.code).toBe(code);
    expect(error.details).toEqual(details);
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.name).toBe(error.constructor.name);
  });

  it('parity AppError ↔ ErrorCode của contracts: mỗi code có đúng một lớp lỗi, không thiếu, không thừa', () => {
    const classCodes = CATALOG.map(([e]) => e.code);
    expect(new Set(classCodes).size).toBe(classCodes.length);
    expect([...classCodes].sort()).toEqual([...ErrorCode.options].sort());
  });

  it('mọi lớp con của AppError được export đều nằm trong catalog test (không lớp nào lọt lưới)', async () => {
    const errors = await import('./index');
    const exported = (Object.values(errors) as unknown[]).filter(
      (v): v is { name: string; prototype: unknown } =>
        typeof v === 'function' && (v as { prototype: unknown }).prototype instanceof AppError,
    );
    const tested = new Set<unknown>(CATALOG.map(([e]) => e.constructor));
    const abstractBases = new Set<unknown>([errors.ConflictError]);
    expect(
      exported.filter((c) => !tested.has(c) && !abstractBases.has(c)).map((c) => c.name),
    ).toEqual([]);
  });
});

describe('quan hệ kế thừa và chi tiết', () => {
  it('lỗi 401/403 con vẫn là UnauthorizedError/ForbiddenError (bắt chung được)', () => {
    expect(new TokenExpiredError()).toBeInstanceOf(UnauthorizedError);
    expect(new OriginNotAllowedError()).toBeInstanceOf(ForbiddenError);
  });

  it('BusinessRuleViolationError giữ rule kể cả khi extra cố ghi đè', () => {
    const error = new BusinessRuleViolationError('INVALID_ANCHOR', 'msg', {
      rule: 'X',
      beforeId: 'b',
    });
    expect(error.details).toEqual({ rule: 'INVALID_ANCHOR', beforeId: 'b' });
  });

  it('ForbiddenError không có permission ⇒ details null', () => {
    expect(new ForbiddenError().details).toBeNull();
  });

  it('RateLimitedError mang header Retry-After; lỗi khác không có header', () => {
    expect(new RateLimitedError(12).headers).toEqual({ 'Retry-After': '12' });
    expect(new UnauthorizedError().headers).toEqual({});
  });

  it('ImageProcessingBusyError mang Retry-After (mặc định 5 s — F-03b)', () => {
    expect(new ImageProcessingBusyError().headers).toEqual({ 'Retry-After': '5' });
    expect(new ImageProcessingBusyError(9).headers).toEqual({ 'Retry-After': '9' });
    expect(new ImageProcessingUnavailableError().headers).toEqual({});
  });

  it('InternalError giữ nguyên nhân trong cause nhưng message cố định (không lộ nội bộ)', () => {
    const cause = new Error('password=hunter2 at db.ts:42');
    const error = new InternalError(cause);
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain('hunter2');
  });

  it('message tùy chỉnh được giữ', () => {
    expect(new ResourceNotFoundError('project', 'Không thấy dự án').message).toBe(
      'Không thấy dự án',
    );
  });
});
