// F3 (mutation 9 %): decorator khóa "một lô purge" trước đây chỉ có integration (purge-job.int.ts) phủ.
// Unit với `$queryRaw` giả: không cần Postgres, mỗi nhánh của khóa advisory bị kiểm riêng.
import { describe, expect, it, vi } from 'vitest';

import type { IWorkspacePurger } from '../../application/ports/collaborators.port';
import { PurgeRunStopped } from '../../application/purge-errors';
import type { Db } from '../persistence/prisma/db';
import { ExclusivePurgeRun, PURGE_RUN_LOCK_KEY, PurgeRunBusyError } from './exclusive-purge-run';

const WS = '0190f5d0-0000-7000-8000-000000000001';
const NOW = new Date('2026-10-16T03:00:00.000Z');

function setup(
  rows: unknown[] | Error,
  inner: IWorkspacePurger['purge'] = () => Promise.resolve(true),
) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const db = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ sql: strings.join('?'), values });
      return rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows);
    },
  } as unknown as Db;
  const purge = vi.fn(inner);
  return { run: new ExclusivePurgeRun(() => db, { purge }), purge, queries };
}

describe('ExclusivePurgeRun (ADR-095)', () => {
  it('lấy được khóa ⇒ gọi purger bên trong ĐÚNG 1 lần với (workspaceId, now) và trả nguyên kết quả', async () => {
    for (const result of [true, false]) {
      const { run, purge, queries } = setup([{ locked: true }], () => Promise.resolve(result));
      await expect(run.purge(WS, NOW)).resolves.toBe(result);
      expect(purge).toHaveBeenCalledTimes(1);
      expect(purge).toHaveBeenCalledWith(WS, NOW);
      // Câu đầu tiên của transaction lô: khóa xact (tự nhả khi commit/rollback) theo hằng số chung.
      expect(queries).toHaveLength(1);
      expect(queries[0]?.sql).toContain('pg_try_advisory_xact_lock(hashtextextended(');
      expect(queries[0]?.values).toEqual([PURGE_RUN_LOCK_KEY]);
    }
  });

  it.each([
    ['locked = false (instance khác đang chạy lô)', [{ locked: false }]],
    ['không có dòng nào', []],
  ])('%s ⇒ PurgeRunBusyError (dừng lượt), KHÔNG gọi purger bên trong', async (_label, rows) => {
    const { run, purge } = setup(rows);
    const err = await run.purge(WS, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PurgeRunBusyError);
    expect(err).toBeInstanceOf(PurgeRunStopped); // scheduler dừng cả lượt theo lớp cha
    expect(purge).not.toHaveBeenCalled();
  });

  it('lỗi DB khi lấy khóa ⇒ ném nguyên lỗi (không coi là "bận"), không gọi purger', async () => {
    const boom = new Error('connection reset');
    const { run, purge } = setup(boom);
    await expect(run.purge(WS, NOW)).rejects.toBe(boom);
    expect(purge).not.toHaveBeenCalled();
  });

  it('lỗi giữa lô (purger bên trong ném) ⇒ lan ra nguyên vẹn — transaction lô rollback, khóa nhả theo', async () => {
    const midBatch = new Error('FK violation giữa lô');
    const { run, purge } = setup([{ locked: true }], () => Promise.reject(midBatch));
    await expect(run.purge(WS, NOW)).rejects.toBe(midBatch);
    expect(purge).toHaveBeenCalledTimes(1);
  });
});
