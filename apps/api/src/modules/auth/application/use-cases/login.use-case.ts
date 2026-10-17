import type { IClock } from '../../../../core/domain';
import { InvalidCredentialsError, ValidationError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { Email } from '../../domain/email';
import type { SessionMeta } from '../../domain/refresh-token';
import { toUserView, type UserView } from '../auth-shared';
import type { ICompanySessionGate } from '../ports/collaborators.port';
import type { IPasswordHasher } from '../ports/password-hasher.port';
import type { IUserRepository } from '../ports/user-repository.port';
import type { IssuedSession, SessionIssuer } from '../session-issuer';

export interface LoginInput {
  email: string;
  password: string;
  meta: SessionMeta;
}

export interface LoginResult {
  session: IssuedSession;
  user: UserView;
}

export interface LoginDeps {
  users: IUserRepository;
  issuer: SessionIssuer;
  hasher: IPasswordHasher;
  company: ICompanySessionGate;
  uow: IUnitOfWork;
  clock: IClock;
  logger: ILogger;
}

/** security.md 1.2. Rate limit chạy ở middleware TRƯỚC use case. */
export class LoginUseCase {
  constructor(private readonly d: LoginDeps) {}

  async execute(input: LoginInput): Promise<LoginResult> {
    const found = await this.#findUser(input.email);
    // Chờ kích hoạt (`password_hash` null — ADR-137) ⇒ y như không có user (SEC-HR-58).
    const user = found && !found.isDeleted && found.passwordHash !== null ? found : null;
    const passwordHash = user?.passwordHash ?? null;
    if (!user || passwordHash === null) {
      // Vẫn verify với hash giả ⇒ thời gian giống trường hợp sai mật khẩu (LOG-04).
      await this.d.hasher.verify(null, input.password);
      throw this.#failed(null, input.meta);
    }
    if (!(await this.d.hasher.verify(passwordHash, input.password))) {
      throw this.#failed(user.id, input.meta);
    }
    // Không còn thuộc công ty / quá `access_until` ⇒ như sai thông tin (thiết kế Mốc 3.5 "Không mở lỗ").
    if (!(await this.d.company.isActive(user.id))) throw this.#failed(user.id, input.meta);
    // Băm lại (nếu cần) NGOÀI transaction.
    const rehashed = this.d.hasher.needsRehash(passwordHash)
      ? await this.d.hasher.hash(input.password)
      : null;

    // ADR-104: chỉ ghi đúng những cột login được phép đổi, bằng lệnh nguyên tử — không ghi đè
    // thay đổi đồng thời (đổi mật khẩu / đăng xuất mọi nơi) xảy ra trong lúc verify argon2.
    return this.d.uow.run(async () => {
      const now = this.d.clock.now();
      let verifiedHash = passwordHash;
      // Có điều kiện password_hash = hash đã verify: mật khẩu vừa bị đổi ⇒ bỏ qua, không hồi sinh hash cũ.
      if (
        rehashed !== null &&
        (await this.d.users.rehashPassword({
          id: user.id,
          oldHash: passwordHash,
          newHash: rehashed,
          at: now,
        }))
      ) {
        verifiedHash = rehashed;
      }
      // G1 auth M1: phiên chỉ cấp khi mật khẩu trong DB VẪN là mật khẩu vừa verify. Đổi mật khẩu commit
      // trong cửa sổ argon2 ⇒ null ⇒ 401 như sai mật khẩu (không để mật khẩu cũ nhận phiên sống sót).
      const tokenVersion = await this.d.users.recordLogin({
        id: user.id,
        expectedHash: verifiedHash,
        at: now,
      });
      if (tokenVersion === null) throw new InvalidCredentialsError(); // user bị xóa / mật khẩu vừa đổi
      const session = await this.d.issuer.startNew({ id: user.id, tokenVersion }, input.meta);
      return { session, user: toUserView(user) };
    });
  }

  /**
   * Sự kiện bảo mật (ASVS V16, security.md §6.7 — T-028): KHÔNG ghi email (PII) — `userId` khi
   * tài khoản tồn tại (dò mật khẩu nhắm một người), `null` khi không (dò danh sách email).
   */
  #failed(userId: string | null, meta: SessionMeta): InvalidCredentialsError {
    this.d.logger.warn({ userId, ip: meta.ip }, 'auth.login_failed');
    return new InvalidCredentialsError();
  }

  /** Email sai định dạng ⇒ xử lý như không tồn tại (cùng lỗi, cùng thời gian). */
  async #findUser(rawEmail: string) {
    let email: Email;
    try {
      email = Email.create(rawEmail);
    } catch (err) {
      if (err instanceof ValidationError) return null;
      throw err;
    }
    return this.d.users.findByEmail(email);
  }
}
