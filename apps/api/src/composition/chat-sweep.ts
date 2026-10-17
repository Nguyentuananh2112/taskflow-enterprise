import type { IClock } from '../core/domain';
import type { IFileSweepTask } from '../core/files/files-sweep';
import type { IFileStore } from '../core/files/ports';
import type { IUnitOfWork } from '../core/persistence/unit-of-work';
import type { ChatRepositories } from '../modules/chat/chat.module';
import { CHAT_RETENTION_DAYS, deleteKeys as deleteBlobKeys } from './chat-files';

const DAY_MS = 86_400_000;
export const CHAT_SWEEP_BATCH = 500;
/** Trần lô mỗi lượt cho từng bước — phần còn lại để lượt sau (mỗi giờ). */
export const CHAT_SWEEP_MAX_BATCHES = 20;

/**
 * Bước `chat` của `files-sweep` (ADR-147 D12/D14; T-069 — gộp "chat-retention" vào job dọn tệp: chung advisory
 * lock, cùng mẫu "xóa DB trước, đĩa sau commit"):
 * 1. tin quá 12 tháng (giờ NGHIỆP VỤ) + đính kèm của chúng;
 * 2. upload chưa gắn quá `orphanTtlSec` (24 giờ, giờ thật — cửa sổ ngắn);
 * 3. `left_at` cho participant của người không còn dòng `company_members` (danh sách thành viên đúng — ADR-143);
 * 4. blob trong namespace `chat/` (CHỈ của chat — B M1) KHÔNG còn dòng nào tham chiếu, cũ hơn `orphanTtlSec` (crash giữa commit và xóa đĩa,
 *    upload hỏng giữa chừng) — blob mới để yên: có thể là upload đang ghi dòng.
 */
export function chatSweepTask(d: {
  repos: ChatRepositories;
  store: IFileStore;
  uow: IUnitOfWork;
  businessClock: IClock;
  clock: IClock;
  orphanTtlSec: number;
}): IFileSweepTask {
  const deleteKeys = (keys: readonly string[]) => deleteBlobKeys(d.store, keys);
  /** Lặp lô tới khi hết / chạm trần / bị hủy; mỗi lô một transaction, đĩa sau commit. */
  async function batches(
    signal: AbortSignal | undefined,
    step: () => Promise<{ count: number; keys: string[] }>,
  ): Promise<number> {
    let total = 0;
    for (let i = 0; i < CHAT_SWEEP_MAX_BATCHES && !signal?.aborted; i++) {
      const { count, keys } = await d.uow.run(step);
      await deleteKeys(keys);
      total += count;
      if (count < CHAT_SWEEP_BATCH) break;
    }
    return total;
  }

  return {
    name: 'chat',
    async run({ signal }) {
      const a = d.repos.attachments;
      const cutoff = new Date(d.businessClock.now().getTime() - CHAT_RETENTION_DAYS * DAY_MS);
      const orphanBefore = new Date(d.clock.now().getTime() - d.orphanTtlSec * 1000);
      let done = await batches(signal, async () => {
        const r = await a.purgeMessagesBefore(cutoff, CHAT_SWEEP_BATCH);
        return { count: r.deleted, keys: r.blobKeys };
      });
      done += await batches(signal, async () => {
        const keys = await a.purgeOrphanUploadsBefore(orphanBefore, CHAT_SWEEP_BATCH);
        return { count: keys.length, keys };
      });
      done += await batches(signal, async () => ({
        count: await d.repos.conversations.markLeftForNonMembers(
          d.businessClock.now(),
          CHAT_SWEEP_BATCH,
        ),
        keys: [],
      }));
      return done + (signal?.aborted ? 0 : await unreferenced(orphanBefore));
    },
  };

  async function unreferenced(before: Date): Promise<number> {
    let removed = 0;
    let chunk: string[] = [];
    const flush = async () => {
      const referenced = await d.repos.attachments.existingBlobKeys(chunk);
      const dead = chunk.filter((k) => !referenced.has(k));
      await deleteKeys(dead);
      removed += dead.length;
      chunk = [];
    };
    for await (const { key, modifiedAt } of d.store.list('chat')) {
      if (modifiedAt >= before) continue;
      chunk.push(key);
      if (chunk.length >= CHAT_SWEEP_BATCH) await flush();
    }
    if (chunk.length > 0) await flush();
    return removed;
  }
}
