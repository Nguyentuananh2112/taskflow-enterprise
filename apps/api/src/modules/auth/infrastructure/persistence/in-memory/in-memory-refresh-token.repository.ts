import type { IRefreshTokenRepository } from '../../../application/ports/refresh-token-repository.port';
import {
  RefreshToken,
  type RefreshTokenRevokeReason,
  type RefreshTokenSnapshot,
} from '../../../domain/refresh-token';

type Row = RefreshTokenSnapshot;

export class InMemoryRefreshTokenRepository implements IRefreshTokenRepository {
  #rows = new Map<string, Row>();

  add(token: RefreshToken): Promise<void> {
    const snap = token.toSnapshot();
    if ([...this.#rows.values()].some((r) => r.tokenHash === snap.tokenHash)) {
      return Promise.reject(new Error('unique violation: refresh_tokens.token_hash'));
    }
    this.#rows.set(snap.id, snap);
    return Promise.resolve();
  }

  findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const row = [...this.#rows.values()].find((r) => r.tokenHash === tokenHash);
    return Promise.resolve(row ? RefreshToken.reconstitute(row) : null);
  }

  markRotated(id: string, successorId: string, at: Date): Promise<boolean> {
    const row = this.#rows.get(id);
    if (!row || row.revokedAt !== null) return Promise.resolve(false);
    this.#rows.set(id, {
      ...row,
      revokedAt: at,
      revokedReason: 'ROTATED',
      replacedById: successorId,
    });
    return Promise.resolve(true);
  }

  revokeFamily(familyId: string, reason: RefreshTokenRevokeReason, at: Date): Promise<number> {
    return Promise.resolve(this.#revokeWhere((r) => r.familyId === familyId, reason, at));
  }

  revokeAllForUser(userId: string, reason: RefreshTokenRevokeReason, at: Date): Promise<number> {
    return Promise.resolve(this.#revokeWhere((r) => r.userId === userId, reason, at));
  }

  isSessionRevoked(familyId: string): Promise<boolean> {
    return Promise.resolve(
      [...this.#rows.values()].some(
        (r) =>
          r.familyId === familyId &&
          (r.revokedReason === 'LOGOUT' || r.revokedReason === 'REUSE_DETECTED'),
      ),
    );
  }

  rows(): Row[] {
    return [...this.#rows.values()].map((r) => ({ ...r }));
  }

  snapshot(): unknown {
    return new Map([...this.#rows].map(([k, v]) => [k, { ...v }]));
  }

  restore(snapshot: unknown): void {
    this.#rows = snapshot as Map<string, Row>;
  }

  #revokeWhere(match: (r: Row) => boolean, reason: RefreshTokenRevokeReason, at: Date): number {
    let count = 0;
    for (const [id, row] of this.#rows) {
      if (row.revokedAt === null && match(row)) {
        this.#rows.set(id, { ...row, revokedAt: at, revokedReason: reason });
        count += 1;
      }
    }
    return count;
  }
}
