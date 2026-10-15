// G1 F4 (cross-read T-033): một workspace purge lỗi KHÔNG được dừng cả lô — trước đây workspace lỗi
// có `purge_at` cũ nhất đứng đầu MỌI lượt ⇒ không workspace nào được purge nữa, backlog tăng mãi.
import { beforeEach, describe, expect, it } from 'vitest';

import type { IWorkspacePurger } from '../ports/collaborators.port';
import { PurgeRunStopped } from '../purge-errors';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { PurgeDeletedWorkspacesJob } from './purge-deleted-workspaces.job';

const DAY = 86_400_000;
let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;

beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
  for (const [wsId, actor] of [
    [ctx.A, 'alice'],
    [ctx.B, 'bob'],
  ] as const) {
    const ws = (await h.workspaces.findById(wsId))!;
    ws.softDelete(uid(actor), h.clock.now());
    await h.workspaces.save(ws);
    h.clock.advance(1); // A có purge_at cũ hơn B ⇒ A đứng đầu danh sách
  }
  h.clock.advance(31 * DAY);
});

/** Purger thật của harness, nhưng ném lỗi cho các workspace trong `failing`. */
function purgerFailingFor(
  failing: Set<string>,
  error: () => Error = () => new Error('db timeout'),
) {
  const real = h.purger;
  const purger: IWorkspacePurger = {
    purge: (id, now) => (failing.has(id) ? Promise.reject(error()) : real.purge(id, now)),
  };
  return new PurgeDeletedWorkspacesJob({ ...h, purger });
}

describe('PurgeDeletedWorkspacesJob — lỗi từng workspace', () => {
  it('workspace đầu tiên lỗi ⇒ các workspace sau VẪN được purge; failed = 1; log warn có workspaceId', async () => {
    const result = await purgerFailingFor(new Set([ctx.A])).execute();
    expect(result).toEqual({ purged: 1, skipped: 0, failed: 1 });
    expect((await h.workspaces.rows()).map((w) => w.id)).toEqual([ctx.A]); // B đã purge, A còn
    expect(h.logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'workspace.purge_failed',
        data: expect.objectContaining({ workspaceId: ctx.A }) as unknown,
      }),
    );
  });

  it('lượt sau thử lại workspace từng lỗi (idempotent) ⇒ purge được', async () => {
    await purgerFailingFor(new Set([ctx.A])).execute();
    const retry = await new PurgeDeletedWorkspacesJob(h).execute();
    expect(retry).toEqual({ purged: 1, skipped: 0, failed: 0 });
    expect(await h.workspaces.rows()).toEqual([]);
  });

  it('PurgeRunStopped (instance khác đang chạy lô) ⇒ DỪNG cả lượt, ném tiếp — không nuốt', async () => {
    class Busy extends PurgeRunStopped {}
    await expect(
      purgerFailingFor(new Set([ctx.A]), () => new Busy()).execute(),
    ).rejects.toBeInstanceOf(PurgeRunStopped);
    expect(await h.workspaces.rows()).toHaveLength(2); // không purge thêm gì
  });
});
