import { describe, expect, it } from 'vitest';

import * as workspacePublicApi from './index';

describe('modules/workspace/index.ts (public API)', () => {
  it('chỉ export type — không có giá trị runtime nào (phụ thuộc giữa module ở mức type)', () => {
    expect(Object.keys(workspacePublicApi)).toEqual([]);
  });
});
