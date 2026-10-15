import { ResourceConflictError } from '../../../core/errors';
import type {
  IMembershipReader,
  IWorkspaceProvisioner,
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

/** Module Workspace giả: ghi lời gọi, có thể ném trùng slug N lần đầu (REG-11/12). */
export class FakeWorkspaceProvisioner implements IWorkspaceProvisioner {
  readonly calls: {
    input: Parameters<IWorkspaceProvisioner['provisionDefault']>[0];
    inTransaction: boolean;
  }[] = [];
  slugConflicts = 0;
  #seq = 0;

  constructor(private readonly uow: { readonly inTransaction: boolean }) {}

  provisionDefault(
    input: Parameters<IWorkspaceProvisioner['provisionDefault']>[0],
  ): Promise<{ workspaceId: string }> {
    this.calls.push({ input, inTransaction: this.uow.inTransaction });
    if (this.slugConflicts > 0) {
      this.slugConflicts -= 1;
      return Promise.reject(new ResourceConflictError({ reason: 'taken', field: 'slug' }));
    }
    this.#seq += 1;
    return Promise.resolve({ workspaceId: `ws-${this.#seq}` });
  }
}

export class FakeMembershipReader implements IMembershipReader {
  readonly byUser = new Map<string, MembershipView[]>();

  listForUser(userId: string): Promise<MembershipView[]> {
    return Promise.resolve(this.byUser.get(userId) ?? []);
  }
}
