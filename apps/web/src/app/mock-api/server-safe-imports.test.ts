import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Mock API chạy trong route handler PHÍA SERVER của next dev (app/mock-api/v1/[...path]/route.ts).
// Import barrel `@/entities|features|widgets|views` kéo theo hook React ⇒ next dev báo lỗi RSC và MỌI
// route mock trả 500 (T-041c: `DAY_STATUS`/`dateIn` từ `@/entities/attendance`). Vitest/jsdom không
// thấy lỗi này ⇒ chặn bằng test.

const dir = import.meta.dirname;

describe('mock-api chỉ import thứ an toàn phía server', () => {
  it('không file nào import @/entities, @/features, @/widgets, @/views', () => {
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) =>
        /from '@\/(entities|features|widgets|views)\b/.test(
          readFileSync(path.join(dir, f), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
