import { describe, expect, it } from 'vitest';

import { BusinessRule, ErrorCode } from '../common/error-codes';
import { CompanyDto, UpdateCompanyBody } from '../company/company.schemas';
import {
  AckPrivacyBody,
  PRIVACY_NOTICE_VERSION,
  PrivacyConsentBody,
  PrivacyConsentResultDto,
  PrivacyDto,
} from './privacy.schemas';

describe('T-075 thông báo quyền riêng tư', () => {
  it('PrivacyDto: chưa xác nhận ⇒ ackVersion / ackedAt null; đầu mối có thể null', () => {
    const dto = {
      version: PRIVACY_NOTICE_VERSION,
      ackVersion: null,
      ackedAt: null,
      needsAck: true,
      consentLeaveReason: false,
      consentLeaveReasonAt: null,
      companyName: 'Công ty Mẫu',
      privacyContact: null,
    };
    expect(PrivacyDto.strict().parse(dto)).toEqual(dto);
    expect(
      PrivacyConsentResultDto.parse({ ...dto, clearedPendingReasons: 2 }).clearedPendingReasons,
    ).toBe(2);
    expect(PrivacyConsentResultDto.safeParse(dto).success).toBe(false);
  });

  it('LEAVE_REASON_CONSENT_REQUIRED là BusinessRule (422), không phải ErrorCode', () => {
    expect(BusinessRule.options).toContain('LEAVE_REASON_CONSENT_REQUIRED');
    expect(ErrorCode.options).not.toContain('LEAVE_REASON_CONSENT_REQUIRED');
  });

  it('ack / consent: strict, kiểu đúng', () => {
    expect(AckPrivacyBody.safeParse({ version: 1 }).success).toBe(true);
    expect(AckPrivacyBody.safeParse({ version: 0 }).success).toBe(false);
    expect(AckPrivacyBody.safeParse({}).success).toBe(false);
    expect(PrivacyConsentBody.safeParse({ leaveReason: true }).success).toBe(true);
    expect(PrivacyConsentBody.safeParse({ leaveReason: 'yes' }).success).toBe(false);
    expect(PrivacyConsentBody.safeParse({ leaveReason: true, x: 1 }).success).toBe(false);
  });

  it('PATCH /company: đổi tên và / hoặc đầu mối (≤ 200, null / rỗng ⇒ xóa); thiếu cả hai ⇒ sai', () => {
    expect(UpdateCompanyBody.safeParse({ name: 'A', expectedVersion: 1 }).success).toBe(true);
    expect(
      UpdateCompanyBody.safeParse({ privacyContact: 'dpo@cty.vn', expectedVersion: 1 }).success,
    ).toBe(true);
    expect(UpdateCompanyBody.safeParse({ privacyContact: null, expectedVersion: 1 }).success).toBe(
      true,
    );
    expect(
      UpdateCompanyBody.safeParse({ privacyContact: 'x'.repeat(201), expectedVersion: 1 }).success,
    ).toBe(false);
    expect(UpdateCompanyBody.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(CompanyDto.safeParse({ name: 'A', version: 1, privacyContact: null }).success).toBe(
      true,
    );
  });
});
