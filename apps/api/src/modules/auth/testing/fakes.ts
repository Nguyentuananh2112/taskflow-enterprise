import type {
  ICompanySessionGate,
  IMembershipReader,
  MeCompanyView,
  MembershipView,
} from '../application/ports/collaborators.port';
import type { IPasswordHasher } from '../application/ports/password-hasher.port';
import { PasswordPolicy } from '../domain/password-policy';

/** test-spec §0.2: `hash(p) = "h:" + NFC(p)`, ghi lại mọi lời gọi (để kiểm DUMMY_HASH, thứ tự). */
export class FakePasswordHasher implements IPasswordHasher {
  static readonly DUMMY = 'h:<dummy>';
  readonly calls: { method: 'hash' | 'verify'; hashed?: string | null; inTransaction: boolean }[] =
    [];
  rehashNeeded = false;

  constructor(private readonly uow?: { readonly inTransaction: boolean }) {}

  hash(password: string): Promise<string> {
    this.calls.push({ method: 'hash', inTransaction: this.uow?.inTransaction ?? false });
    return Promise.resolve(`h:${PasswordPolicy.normalize(password)}`);
  }

  verify(hashed: string | null, password: string): Promise<boolean> {
    const target = hashed ?? FakePasswordHasher.DUMMY;
    this.calls.push({ method: 'verify', hashed: target, inTransaction: false });
    return Promise.resolve(hashed !== null && hashed === `h:${PasswordPolicy.normalize(password)}`);
  }

  needsRehash(): boolean {
    return this.rehashNeeded;
  }
}

/**
 * Module company giả: mặc định MỌI user là nhân viên đang làm; `revoked` = không còn thuộc công ty / quá
 * `access_until` (Mốc 3.5).
 */
export class FakeCompanyGate implements ICompanySessionGate {
  readonly revoked = new Set<string>();
  name: string | null = 'Công ty Test';

  isActive(userId: string): Promise<boolean> {
    return Promise.resolve(!this.revoked.has(userId));
  }

  meOf(userId: string): Promise<MeCompanyView | null> {
    if (this.revoked.has(userId)) return Promise.resolve(null);
    return Promise.resolve({
      name: this.name,
      role: 'EMPLOYEE',
      grants: [],
      permissions: ['attendance:self', 'leave:self', 'workspace:create'],
      status: 'ACTIVE',
      offboardLastDay: null,
    });
  }

  companyName(): Promise<string | null> {
    return Promise.resolve(this.name);
  }
}

export class FakeMembershipReader implements IMembershipReader {
  readonly byUser = new Map<string, MembershipView[]>();

  listForUser(userId: string): Promise<MembershipView[]> {
    return Promise.resolve(this.byUser.get(userId) ?? []);
  }
}
