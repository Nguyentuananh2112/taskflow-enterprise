import {
  PRIVACY_NOTICE_VERSION,
  type PrivacyConsentResultDto,
  type PrivacyDto,
} from '@taskflow/contracts';

import type { IClock } from '../../../../core/domain';
import { ResourceConflictError, UnauthorizedError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type {
  IPendingLeaveReasons,
  IPrivacyCompanyInfo,
  IPrivacyStore,
  PrivacyState,
} from '../ports/privacy.port';

export interface PrivacyUseCaseDeps {
  store: IPrivacyStore;
  company: IPrivacyCompanyInfo;
  /** Rút đồng ý ⇒ xóa lý do của đơn nghỉ đang chờ (leave). */
  pendingLeaveReasons: IPendingLeaveReasons;
  uow: IUnitOfWork;
  /** Giờ thật (thời điểm xác nhận / đồng ý là bằng chứng — không theo giờ nghiệp vụ). */
  clock: IClock;
  /** `X-Request-Id` của request đang chạy (bằng chứng — đối chiếu log); null ngoài HTTP. */
  requestId?: () => string | null;
  /** = `PRIVACY_NOTICE_VERSION` (test đổi được để giả lập đổi nội dung). */
  version?: number;
}

/**
 * Thông báo quyền riêng tư (T-075, data-retention.md §5) — luôn của CHÍNH người gọi (`req.user.id`). Admin cũng
 * dùng (không phải nhân viên nhưng có chat / avatar). Mỗi lần đổi trạng thái có sự kiện chỉ-thêm (bằng chứng — store).
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
   * Xác nhận lại cùng phiên bản ⇒ không đổi gì (giữ thời điểm đầu).
   */
  async ack(userId: string, version: number): Promise<PrivacyDto> {
    if (version !== this.#version) {
      throw new ResourceConflictError(
        { reason: 'privacy_version_outdated' },
        'Thông báo đã có nội dung mới — vui lòng đọc lại.',
      );
    }
    const state = await this.d.uow.run(async () => {
      const ok = await this.d.store.ack({ userId, version, ...this.#evidence() });
      if (!ok) throw new UnauthorizedError();
      return this.d.store.get(userId);
    });
    return this.#dto(state);
  }

  /**
   * Đồng ý / rút lại đồng ý xử lý lý do nghỉ. Rút lại ⇒ CÙNG transaction xóa lý do của các đơn ĐANG CHỜ DUYỆT của chính
   * mình (NĐ 13 Đ.12 — dừng xử lý tiếp; TL theo soát B); đơn đã quyết giữ tới hạn D3.
   */
  async setLeaveReasonConsent(userId: string, consent: boolean): Promise<PrivacyConsentResultDto> {
    const { state, cleared } = await this.d.uow.run(async () => {
      const ok = await this.d.store.setLeaveReasonConsent({
        userId,
        consent,
        noticeVersion: this.#version,
        ...this.#evidence(),
      });
      if (!ok) throw new UnauthorizedError();
      const n = consent ? 0 : await this.d.pendingLeaveReasons.clearPendingReasons(userId);
      return { state: await this.d.store.get(userId), cleared: n };
    });
    return { ...(await this.#dto(state)), clearedPendingReasons: cleared };
  }

  #evidence() {
    return { at: this.d.clock.now(), requestId: this.d.requestId?.() ?? null };
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
