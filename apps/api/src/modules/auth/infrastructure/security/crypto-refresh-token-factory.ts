import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type {
  GeneratedRefreshToken,
  IRefreshTokenFactory,
} from '../../application/ports/refresh-token-factory.port';

const TOKEN_BYTES = 32; // 256 bit entropy
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * SHA-256 (không dùng hàm băm chậm) vì token đã có entropy cao và phải tra DB theo hash
 * (security.md 2.2, ADR-024).
 */
export class CryptoRefreshTokenFactory implements IRefreshTokenFactory {
  generate(): GeneratedRefreshToken {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  matches(token: string, expectedHash: string): boolean {
    if (!SHA256_HEX.test(expectedHash)) return false;
    return timingSafeEqual(Buffer.from(this.hash(token), 'hex'), Buffer.from(expectedHash, 'hex'));
  }
}
