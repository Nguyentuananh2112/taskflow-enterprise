import { describe, expect, it } from 'vitest';

import * as notificationsPublicApi from './index';

describe('modules/notifications/index.ts (public API)', () => {
  it('chỉ export type — không có giá trị runtime nào (phụ thuộc giữa module ở mức type)', () => {
    expect(Object.keys(notificationsPublicApi)).toEqual([]);
  });
});
