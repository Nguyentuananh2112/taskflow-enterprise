import { describe, expect, it } from 'vitest';

import { computeMoveIntent, intentToEdge, type ColumnIds } from './compute-move-intent';

const cols = (partial: Partial<Record<keyof ColumnIds, string[]>>): ColumnIds => ({
  TODO: [],
  IN_PROGRESS: [],
  REVIEW: [],
  DONE: [],
  ...partial,
});

describe('computeMoveIntent (frontend.md §4.3)', () => {
  const before = cols({ TODO: ['a', 'b', 'c'], IN_PROGRESS: ['x', 'y'] });

  it('cùng cột lên đầu ⇒ afterId null, beforeId = thẻ đầu cũ', () => {
    expect(
      computeMoveIntent(before, cols({ TODO: ['c', 'a', 'b'], IN_PROGRESS: ['x', 'y'] }), 'c'),
    ).toEqual({
      afterId: null,
      beforeId: 'a',
    });
  });

  it('cùng cột vào giữa ⇒ hai hàng xóm, không gửi status', () => {
    expect(
      computeMoveIntent(before, cols({ TODO: ['b', 'a', 'c'], IN_PROGRESS: ['x', 'y'] }), 'a'),
    ).toEqual({
      afterId: 'b',
      beforeId: 'c',
    });
  });

  it('khác cột, thả cuối ⇒ status + afterId = thẻ cuối, beforeId null', () => {
    const after = cols({ TODO: ['b', 'c'], IN_PROGRESS: ['x', 'y', 'a'] });
    expect(computeMoveIntent(before, after, 'a')).toEqual({
      status: 'IN_PROGRESS',
      afterId: 'y',
      beforeId: null,
    });
  });

  it('cột đích rỗng ⇒ cả hai null', () => {
    const after = cols({ TODO: ['b', 'c'], IN_PROGRESS: ['x', 'y'], REVIEW: ['a'] });
    expect(computeMoveIntent(before, after, 'a')).toEqual({
      status: 'REVIEW',
      afterId: null,
      beforeId: null,
    });
  });

  it('không đổi vị trí ⇒ null (không gửi request)', () => {
    expect(computeMoveIntent(before, before, 'b')).toBeNull();
  });

  it('task không có trong cột ⇒ null', () => {
    expect(computeMoveIntent(before, before, 'zzz')).toBeNull();
  });

  it('đang lọc: dùng hàng xóm HIỂN THỊ (server đặt ngay sau afterId)', () => {
    // Bộ lọc ẩn 'b': cột hiển thị chỉ còn a, c.
    const visible = cols({ TODO: ['a', 'c'] });
    expect(computeMoveIntent(visible, cols({ TODO: ['c', 'a'] }), 'a')).toEqual({
      afterId: 'c',
      beforeId: null,
    });
  });
});

describe('intentToEdge — đường thay thế không cần kéo (SC 2.5.7)', () => {
  const columns = cols({ TODO: ['a', 'b', 'c'], IN_PROGRESS: ['x'] });

  it('Chuyển tới cột khác ⇒ cuối cột đích', () => {
    expect(intentToEdge(columns, 'b', { status: 'IN_PROGRESS', edge: 'bottom' })).toEqual({
      status: 'IN_PROGRESS',
      afterId: 'x',
      beforeId: null,
    });
  });

  it('Lên đầu cột', () => {
    expect(intentToEdge(columns, 'c', { status: 'TODO', edge: 'top' })).toEqual({
      afterId: null,
      beforeId: 'a',
    });
  });

  it('Xuống cuối cột khi đã ở cuối ⇒ null', () => {
    expect(intentToEdge(columns, 'c', { status: 'TODO', edge: 'bottom' })).toBeNull();
  });
});
