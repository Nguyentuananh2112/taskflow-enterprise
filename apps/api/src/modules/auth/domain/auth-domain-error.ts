// TODO(T-009): hợp nhất vào cây AppError/BusinessRuleViolationError của core khi T-009 merge.
// Tạm thời là lỗi domain thuần của module auth — presentation sẽ map `code` sang HTTP.

export type AuthDomainErrorCode = 'INVALID_EMAIL';

export class AuthDomainError extends Error {
  readonly code: AuthDomainErrorCode;

  constructor(code: AuthDomainErrorCode, message: string) {
    super(message);
    this.name = 'AuthDomainError';
    this.code = code;
  }
}
