import { NotFoundDetails } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { ResourceNotFoundError, type ResourceKind } from '../src/core/errors';

/** Kiểu bằng nhau hai chiều — lệch ⇒ lỗi biên dịch (typecheck), không đợi tới runtime. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const resourceKindMatchesContracts: Same<ResourceKind, NotFoundDetails['resource']> = true;

// data-and-api §3.2: `details.resource` của 404. Core khai báo `ResourceKind` riêng; contracts là
// hợp đồng FE đọc. T-023 thêm `route` (404 route không xác định, T-021).
describe('parity ResourceKind (core/errors) ↔ NotFoundDetails (contracts)', () => {
  it('mọi resource của contracts dựng được lỗi 404 với details hợp lệ theo contracts', () => {
    expect(resourceKindMatchesContracts).toBe(true);
    for (const resource of NotFoundDetails.shape.resource.options) {
      const err = new ResourceNotFoundError(resource);
      expect(NotFoundDetails.parse(err.details)).toEqual({ resource });
    }
  });
});
