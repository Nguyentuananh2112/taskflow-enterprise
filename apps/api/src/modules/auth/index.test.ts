import { describe, expect, it } from 'vitest';

import * as authPublicApi from './index';

describe('modules/auth/index.ts (public API)', () => {
  it('chỉ export type — không có giá trị runtime nào (phụ thuộc giữa module ở mức type)', () => {
    expect(Object.keys(authPublicApi)).toEqual([]);
  });
});
