import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, inject } from 'vitest';

/**
 * setupFile của integration: mọi file dùng CHUNG một DB ⇒ tại một thời điểm chỉ được MỘT file chạy.
 * `mkdir` là nguyên tử: file thứ hai vào khi file đầu chưa xong ⇒ đỏ ngay với thông báo rõ, thay vì
 * 40P01 / P2002 / P2003 khó hiểu. Bắt cả `--maxWorkers` trên CLI (thứ duy nhất còn thắng config).
 * Cờ ghi pid worker: worker trước chết cứng (OOM/kill, afterAll không chạy) ⇒ file sau tiếp quản cờ thay vì
 * đỏ oan "song song" cho cả phần còn lại của lượt.
 */
export const RUNNING_MARKER = 'file-running';

let held = false;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

beforeAll(() => {
  const marker = join(inject('integrationRunDir'), RUNNING_MARKER);
  const pidFile = join(marker, 'pid');
  try {
    mkdirSync(marker);
    writeFileSync(pidFile, String(process.pid));
    held = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      let owner = NaN;
      try {
        owner = Number(readFileSync(pidFile, 'utf8'));
      } catch {
        // chưa kịp ghi pid ⇒ file kia vừa vào: coi như đang sống
      }
      if (Number.isInteger(owner) && owner !== process.pid && !alive(owner)) {
        console.warn(
          `[integration] worker ${String(owner)} của file trước đã chết bất thường — tiếp quản cờ`,
        );
        writeFileSync(pidFile, String(process.pid));
        held = true;
        return;
      }
      throw new Error(
        'Hai file integration đang chạy SONG SONG trên cùng một DB — phải tuần tự (maxWorkers 1). ' +
          'Đừng truyền --maxWorkers cho test:integration; VITEST_MAX_WORKERS chỉ dành cho unit.',
        { cause: err },
      );
    }
    throw err;
  }
});

afterAll(() => {
  if (held)
    rmSync(join(inject('integrationRunDir'), RUNNING_MARKER), { recursive: true, force: true });
  held = false;
});
