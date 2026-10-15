import type { ChildProcess } from 'node:child_process';

/**
 * Dừng tiến trình con (API `main.ts` thật) và CHỜ nó thoát hẳn. Chỉ `kill()` rồi đi tiếp ⇒ con còn
 * giữ kết nối Postgres/Valkey trong khi file sau đã TRUNCATE / FLUSHDB (lỗi chéo file, 429 ở
 * prisma-startup). SIGTERM trước, quá `graceMs` ⇒ SIGKILL.
 */
export async function stopChildren(
  children: readonly ChildProcess[],
  graceMs = 15_000,
): Promise<void> {
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((r) => child.once('exit', () => r()));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), graceMs);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}
