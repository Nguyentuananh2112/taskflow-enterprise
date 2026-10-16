import { randomBytes } from 'node:crypto';

import {
  hash as argonHash,
  parseOptions,
  verify as argonVerify,
  type Options,
} from '@node-rs/argon2';

import type { ILogger } from '../../../../core/logging/logger';
import type { IPasswordHasher } from '../../application/ports/password-hasher.port';
import { PasswordPolicy } from '../../domain/password-policy';

/**
 * ADR-065: argon2id, tham số OWASP m=47104 KiB (46 MiB), t=1, p=1. Mỗi lần băm/verify chiếm
 * ~46 MiB — số lần đồng thời bị chặn bởi threadpool libuv (security.md 6.5).
 * `algorithm`/`version` là const enum ambient (không dùng được với isolatedModules) nên ghi số.
 */
export const ARGON2ID_PARAMS = {
  algorithm: 2, // Algorithm.Argon2id
  version: 1, // Version.V0x13 (v=19)
  memoryCost: 47_104,
  timeCost: 1,
  parallelism: 1,
  outputLen: 32,
} as const satisfies Options;

/** Cho phép test tiêm spy; mặc định là hàm thật của @node-rs/argon2. */
export interface Argon2Impl {
  hash(password: string, options: Options): Promise<string>;
  verify(hashed: string, password: string): Promise<boolean>;
}

const REAL_IMPL: Argon2Impl = { hash: argonHash, verify: argonVerify };

/**
 * Quan sát (CHỈ để kiểm thử hộp đen — SEC-27): gọi SAU mỗi lần argon2.verify thật sự chạy, cho biết
 * đã verify hash lưu trong DB (`stored`) hay hash giả (`dummy`, email không tồn tại / user đã xóa).
 * Composition chỉ truyền hàm này khi `APP_ENV=test`; production không có ⇒ không thêm bề mặt.
 */
export type Argon2VerifyObserver = (target: 'stored' | 'dummy') => void;

export class Argon2idPasswordHasher implements IPasswordHasher {
  private constructor(
    private readonly impl: Argon2Impl,
    private readonly dummyHash: string,
    private readonly onVerify?: Argon2VerifyObserver,
  ) {}

  /** Tạo hash giả NGAY lúc khởi động — nếu tạo lười thì lần login "không có email" đầu tiên chậm gấp đôi. */
  static async create(
    impl: Argon2Impl = REAL_IMPL,
    onVerify?: Argon2VerifyObserver,
  ): Promise<Argon2idPasswordHasher> {
    const dummy = await impl.hash(randomBytes(32).toString('base64url'), ARGON2ID_PARAMS);
    return new Argon2idPasswordHasher(impl, dummy, onVerify);
  }

  /** Composition root: observer `test.argon2_verify` CHỈ khi `APP_ENV=test` (SEC-27); nơi khác: không có. */
  static forEnv(appEnv: string, logger: Pick<ILogger, 'info'>): Promise<Argon2idPasswordHasher> {
    return Argon2idPasswordHasher.create(
      REAL_IMPL,
      appEnv === 'test' ? (target) => logger.info({ target }, 'test.argon2_verify') : undefined,
    );
  }

  async hash(password: string): Promise<string> {
    if (PasswordPolicy.exceedsMaxLength(password)) {
      throw new RangeError('Mật khẩu vượt độ dài tối đa — PasswordPolicy phải chặn trước khi băm');
    }
    return this.impl.hash(PasswordPolicy.normalize(password), ARGON2ID_PARAMS);
  }

  async verify(hashed: string | null, password: string): Promise<boolean> {
    // Chống DoS: không đưa chuỗi khổng lồ vào argon2. Không lộ thông tin tài khoản (chỉ lộ "quá dài").
    if (PasswordPolicy.exceedsMaxLength(password)) return false;
    const normalized = PasswordPolicy.normalize(password);
    if (hashed === null) {
      await this.safeVerify(this.dummyHash, normalized, 'dummy'); // cân thời gian, kết quả bỏ đi
      return false;
    }
    return this.safeVerify(hashed, normalized, 'stored');
  }

  needsRehash(hashed: string): boolean {
    try {
      const current = parseOptions(hashed);
      return (
        // const enum ambient ⇒ so sánh giá trị số tường minh
        Number(current.algorithm) !== ARGON2ID_PARAMS.algorithm ||
        Number(current.version) !== ARGON2ID_PARAMS.version ||
        current.memoryCost !== ARGON2ID_PARAMS.memoryCost ||
        current.timeCost !== ARGON2ID_PARAMS.timeCost ||
        current.parallelism !== ARGON2ID_PARAMS.parallelism ||
        current.outputLen !== ARGON2ID_PARAMS.outputLen
      );
    } catch {
      return true;
    }
  }

  /** Hash hỏng trong DB không được làm sập request login — coi như sai mật khẩu. */
  private async safeVerify(
    hashed: string,
    password: string,
    target: 'stored' | 'dummy',
  ): Promise<boolean> {
    try {
      return await this.impl.verify(hashed, password);
    } catch {
      return false;
    } finally {
      this.onVerify?.(target);
    }
  }
}
