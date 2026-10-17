import type { CorrectionNotifier } from '../application/ports/collaborators.port';
import type { ICorrectionStore } from '../application/ports/correction-store.port';
import { CorrectionRequestsUseCases } from '../application/use-cases/correction-requests.use-cases';
import { DecideCorrectionUseCases } from '../application/use-cases/decide-correction.use-cases';
import { InMemoryCorrectionStore } from '../infrastructure/persistence/in-memory/in-memory-corrections';
import { createAttendanceHarness } from './attendance-harness';

/**
 * Harness đơn bổ sung giờ (T-056) trên harness attendance chuẩn (Mia, Max, Vic nhân viên; Hana HR; Olivia Admin). Lưu
 * đơn in-memory — bản Prisma chạy lại qua runner LSP khi có migration 8 (T-055).
 */
export async function createCorrectionHarness(now = '2026-11-17 10:00', store?: ICorrectionStore) {
  const t = await createAttendanceHarness(now);
  // Runner LSP: backend Postgres có store Prisma cùng transaction; in-memory ⇒ bản bộ nhớ.
  const corrections = store ?? t.backend.corrections ?? new InMemoryCorrectionStore();
  const sent: Parameters<CorrectionNotifier['notify']>[0][] = [];
  const notifier: CorrectionNotifier = {
    notify: (n) => {
      sent.push(n);
      return Promise.resolve();
    },
  };
  const deps = { ...t.deps, ...t.collaborators, corrections, notifier };
  const own = new CorrectionRequestsUseCases(deps);
  const hr = new DecideCorrectionUseCases(deps);
  const useCases = {
    submit: own.submit.bind(own),
    cancel: own.cancel.bind(own),
    list: own.list.bind(own),
    approve: hr.approve.bind(hr),
    reject: hr.reject.bind(hr),
  };
  return { ...t, corrections, sent, useCases };
}
