export interface GeneratedRefreshToken {
  /** Chuỗi gửi cho client qua cookie — KHÔNG lưu, KHÔNG log. */
  token: string;
  /** SHA-256 hex (64 ký tự) — giá trị duy nhất được lưu ở `refresh_tokens.token_hash`. */
  hash: string;
}

/** Refresh token mờ (opaque), 256 bit entropy (security.md 2.2, ADR-024). */
export interface IRefreshTokenFactory {
  generate(): GeneratedRefreshToken;
  /** Băm token từ cookie để tra DB theo `token_hash`. */
  hash(token: string): string;
  /** So khớp an toàn thời gian (dùng khi đã có sẵn hash, không tra DB). */
  matches(token: string, expectedHash: string): boolean;
}
