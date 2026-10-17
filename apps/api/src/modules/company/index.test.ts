import { describe, expect, it } from 'vitest';

import * as companyPublicApi from './index';

describe('modules/company/index.ts (public API)', () => {
  it('chỉ export type — không có giá trị runtime nào (phụ thuộc giữa module ở mức type)', () => {
    expect(Object.keys(companyPublicApi)).toEqual([]);
  });
});
