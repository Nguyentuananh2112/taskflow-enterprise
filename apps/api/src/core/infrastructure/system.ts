import { randomBytes, randomInt, randomUUIDv7 } from 'node:crypto';

import type { IClock, IIdGenerator, IRandom } from '../domain';

export class SystemClock implements IClock {
  now(): Date {
    return new Date();
  }
}

/**
 * UUID v7 bằng `crypto.randomUUIDv7()` có sẵn từ Node 24.16 (không cần thư viện).
 * Theo RFC 9562: 48 bit đầu là mili giây ⇒ id tăng theo thời gian giữa các mili giây;
 * trong cùng mili giây thứ tự là ngẫu nhiên (đủ cho B-tree, không dùng id để sắp xếp).
 */
export class UuidV7Generator implements IIdGenerator {
  next(): string {
    return randomUUIDv7();
  }
}

export class CryptoRandom implements IRandom {
  token(byteLength: number): string {
    return randomBytes(byteLength).toString('base64url');
  }

  int(min: number, max: number): number {
    return randomInt(min, max);
  }
}
