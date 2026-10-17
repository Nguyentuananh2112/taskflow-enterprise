import { BusinessRule } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { imageUnreadableError } from '../../src/core/errors';

// Mốc 6 (TL 18/10): rule của ảnh hỏng phải nằm trong danh mục contracts — web rẽ nhánh theo nó.
describe('parity luật kho tệp ↔ contracts', () => {
  it('IMAGE_UNREADABLE: 422 BUSINESS_RULE_VIOLATION, rule thuộc BusinessRule', () => {
    const error = imageUnreadableError();
    expect([error.statusCode, error.code, error.details]).toEqual([
      422,
      'BUSINESS_RULE_VIOLATION',
      { rule: 'IMAGE_UNREADABLE' },
    ]);
    expect(BusinessRule.options).toContain('IMAGE_UNREADABLE');
  });
});
