import type {
  ActivationTokenRecord,
  IActivationTokenRepository,
} from '../../../application/ports/activation-token-repository.port';

interface Row extends ActivationTokenRecord {
  tokenHash: string;
  createdById: string | null;
  createdAt: Date;
}

const live = (r: Row) => r.usedAt === null && r.revokedAt === null;

/** Bản InMemory cùng hợp đồng với bản Prisma (LSP); có `snapshot` / `restore` cho UoW giả. */
export class InMemoryActivationTokenRepository implements IActivationTokenRepository {
  #rows = new Map<string, Row>();

  issue(input: Parameters<IActivationTokenRepository['issue']>[0]): Promise<void> {
    for (const r of this.#rows.values()) {
      if (r.userId === input.userId && live(r)) this.#rows.set(r.id, { ...r, revokedAt: input.at });
    }
    if ([...this.#rows.values()].some((r) => r.tokenHash === input.tokenHash)) {
      return Promise.reject(new Error('unique violation: account_activation_tokens.token_hash'));
    }
    this.#rows.set(input.id, {
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      revokedAt: null,
      createdById: input.createdById,
      createdAt: input.at,
    });
    return Promise.resolve();
  }

  findByHash(tokenHash: string): Promise<ActivationTokenRecord | null> {
    const r = [...this.#rows.values()].find((x) => x.tokenHash === tokenHash);
    return Promise.resolve(
      r
        ? {
            id: r.id,
            userId: r.userId,
            expiresAt: r.expiresAt,
            usedAt: r.usedAt,
            revokedAt: r.revokedAt,
          }
        : null,
    );
  }

  consume(id: string, at: Date): Promise<boolean> {
    const r = this.#rows.get(id);
    if (!r || !live(r) || r.expiresAt.getTime() <= at.getTime()) return Promise.resolve(false);
    this.#rows.set(id, { ...r, usedAt: at });
    return Promise.resolve(true);
  }

  revokeAllForUser(userId: string, at: Date): Promise<number> {
    let n = 0;
    for (const r of this.#rows.values()) {
      if (r.userId === userId && live(r)) {
        this.#rows.set(r.id, { ...r, revokedAt: at });
        n += 1;
      }
    }
    return Promise.resolve(n);
  }

  /** Cho test đọc trạng thái lưu trữ. */
  rows(): Row[] {
    return [...this.#rows.values()].map((r) => ({ ...r }));
  }

  snapshot(): unknown {
    return new Map([...this.#rows].map(([k, v]) => [k, { ...v }]));
  }

  restore(snapshot: unknown): void {
    this.#rows = snapshot as Map<string, Row>;
  }
}
