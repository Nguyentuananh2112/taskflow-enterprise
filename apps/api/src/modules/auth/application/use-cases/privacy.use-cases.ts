import { PRIVACY_NOTICE_VERSION, type PrivacyDto } from '@taskflow/contracts';

import type { IClock } from '../../../../core/domain';
import { ResourceConflictError, UnauthorizedError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { IPrivacyCompanyInfo, IPrivacyStore, PrivacyState } from '../ports/privacy.port';

export interface PrivacyUseCaseDeps {
  store: IPrivacyStore;
  company: IPrivacyCompanyInfo;
  uow: IUnitOfWork;
  /** Giờ thật (thời điểm xác nhận / đồng ý là bằng chứng — không theo giờ nghiệp vụ). */
  clock: IClock;
  /** = `PRIVACY_NOTICE_VERSION` (test đổi được để giả lập đổi nội dung). */
  version?: number;
}

/**
 * Thông báo quyền riêng tư (T-075, data-retention.md §5) — luôn của CHÍNH người gọi (`req.user.id`). Admin cũng
 * dùng (không phải nhân viên nhưng có chat / avatar). Không audit HR (TL).
 */
export class PrivacyUseCases {
  readonly #version: number;

  constructor(private readonly d: PrivacyUseCaseDeps) {
    this.#version = d.version ?? PRIVACY_NOTICE_VERSION;
  }

  async get(userId: string): Promise<PrivacyDto> {
    return this.#dto(await this.d.store.get(userId));
  }

  /**
   * Xác nhận phiên bản ĐANG XEM: khác bản hiện hành ⇒ 409 `privacy_version_outdated` (web tải lại nội dung mới).
   * Xác nhận lại cùng phiên bản ⇒ cập nhật thời điểm (idempotent về kết quả).
   */
  async ack(userId: string, version: number): Promise<PrivacyDto> {
    if (version !== this.#version) {
      throw new ResourceConflictError(
        { reason: 'privacy_version_outdated' },
        'Thông báo đã có nội dung mới — vui lòng đọc lại.',
      );
    }
    const state = await this.d.uow.run(async () => {
      const ok = await this.d.store.ack({ userId, version, at: this.d.clock.now() });
      if (!ok) throw new UnauthorizedError();
      return this.d.store.get(userId);
    });
    return this.#dto(state);
  }

  /** Đồng ý / rút lại đồng ý xử lý lý do nghỉ. Rút lại KHÔNG xóa lý do đã ghi (job 13 tháng vẫn xóa — D3). */
  async setLeaveReasonConsent(userId: string, consent: boolean): Promise<PrivacyDto> {
    const state = await this.d.uow.run(async () => {
      const ok = await this.d.store.setLeaveReasonConsent({
        userId,
        consent,
        at: this.d.clock.now(),
      });
      if (!ok) throw new UnauthorizedError();
      return this.d.store.get(userId);
    });
    return this.#dto(state);
  }

  async #dto(s: PrivacyState): Promise<PrivacyDto> {
    const company = await this.d.company.info();
    return {
      version: this.#version,
      ackVersion: s.ackVersion,
      ackedAt: s.ackedAt?.toISOString() ?? null,
      needsAck: s.ackVersion !== this.#version,
      consentLeaveReason: s.consentLeaveReason,
      consentLeaveReasonAt: s.consentLeaveReasonAt?.toISOString() ?? null,
      companyName: company?.name ?? null,
      privacyContact: company?.privacyContact ?? null,
    };
  }
}
