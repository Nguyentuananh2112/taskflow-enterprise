import { mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, inject } from 'vitest';

/**
 * setupFile của integration: mọi file dùng CHUNG một DB ⇒ tại một thời điểm chỉ được MỘT file chạy.
 * `mkdir` là nguyên tử: file thứ hai vào khi file đầu chưa xong ⇒ đỏ ngay với thông báo rõ, thay vì
 * 40P01 / P2002 / P2003 khó hiểu. Bắt cả `--maxWorkers` trên CLI (thứ duy nhất còn thắng config).
 */
export const RUNNING_MARKER = 'file-running';

let held = false;

beforeAll(() => {
  const marker = join(inject('integrationRunDir'), RUNNING_MARKER);
  try {
    mkdirSync(marker);
    held = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
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
  if (held) rmdirSync(join(inject('integrationRunDir'), RUNNING_MARKER));
  held = false;
});
