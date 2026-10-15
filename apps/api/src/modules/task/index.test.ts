import { describe, expect, it } from 'vitest';

import * as taskPublicApi from './index';

describe('modules/task/index.ts (public API)', () => {
  it('chỉ export type — không có giá trị runtime nào (phụ thuộc giữa module ở mức type)', () => {
    expect(Object.keys(taskPublicApi)).toEqual([]);
  });
});
