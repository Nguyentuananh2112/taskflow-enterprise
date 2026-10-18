import type { CorrectionStatus } from '../../domain/correction-request';
import type { LocalDate } from '../../domain/local-time';

/** Một đơn bổ sung giờ (bảng `attendance_correction_requests`, migration 8 — hr-extended §3). */
export interface CorrectionRecord {
  id: string;
  userId: string;
  workDate: LocalDate;
  kind: 'IN' | 'OUT';
  minuteOfDay: number;
  nextDay: boolean;
  /** `null` sau hạn lưu lý do (retention D9 — 13 tháng, trừ PENDING). */
  reason: string | null;
  status: CorrectionStatus;
  idempotencyKey: string;
  decidedById: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdEventId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CorrectionInsertResult = 'ok' | 'pending_exists' | 'key_exists';

/**
 * Lưu đơn bổ sung giờ. Gọi TRONG `uow.run` (sau khóa `taskflow:attendance:punch:<user>`). Hai ràng buộc DB chốt cuối:
 * một PENDING / (user, ngày, loại) — partial unique — và (user, `idempotencyKey`) unique.
 */
export interface ICorrectionStore {
  /** Thêm đơn PENDING; vi phạm unique ⇒ trả loại vi phạm (không ném) — adapter Prisma bắt P2002 theo tên ràng buộc. */
  insert(record: CorrectionRecord): Promise<CorrectionInsertResult>;
  findById(id: string): Promise<CorrectionRecord | null>;
  findByKey(userId: string, idempotencyKey: string): Promise<CorrectionRecord | null>;
  /**
   * Chuyển trạng thái có điều kiện: `UPDATE … WHERE id AND status = 'PENDING' AND version = expectedVersion` (đếm 1),
   * version + 1. Trả dòng mới; không khớp ⇒ `null` (bên gọi đọc lại để phân biệt 409 nào).
   */
  decide(input: {
    id: string;
    expectedVersion: number;
    status: Exclude<CorrectionStatus, 'PENDING'>;
    decidedById: string | null;
    decidedAt: Date | null;
    decisionNote: string | null;
    createdEventId: string | null;
    at: Date;
  }): Promise<CorrectionRecord | null>;
  /** Mới nhất trước (`createdAt` desc, `id` desc); `cursor` = id của dòng cuối trang trước. */
  list(q: {
    userId?: string;
    status?: CorrectionStatus;
    cursor?: string;
    limit: number;
  }): Promise<{ rows: CorrectionRecord[]; nextCursor: string | null }>;
  /**
   * Hoàn tất nghỉ việc (company-level ADR-137 · hr-extended ADR-129): mọi đơn PENDING của `userId` ⇒ CANCELLED (không
   * người quyết định), version + 1. Trả id đã hủy.
   */
  cancelPendingOf(userId: string, at: Date): Promise<string[]>;
}
