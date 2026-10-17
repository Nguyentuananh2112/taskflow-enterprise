-- Mốc 5 (T-055, hr-extended.md ADR-129): đơn bổ sung giờ. Timestamp thư mục là tạm — TL đặt lại lúc merge (migration 8
-- theo thứ tự §8: 7 = payroll T-048). Không cột workspace_id / company_id (ADR-133).

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CORRECTION_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'CORRECTION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'CORRECTION_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'CORRECTION_CANCELLED';

-- CreateTable
CREATE TABLE "attendance_correction_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "kind" "AttendanceKind" NOT NULL,
    "minute_of_day" INTEGER NOT NULL,
    "next_day" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(500),
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(64) NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" VARCHAR(500),
    "created_event_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_correction_requests_created_event_id_key" ON "attendance_correction_requests"("created_event_id");

-- CreateIndex
CREATE INDEX "attendance_correction_requests_status_created_at_id_idx" ON "attendance_correction_requests"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "attendance_correction_requests_user_id_work_date_idx" ON "attendance_correction_requests"("user_id", "work_date");

-- CreateIndex
CREATE INDEX "attendance_correction_requests_decided_by_id_idx" ON "attendance_correction_requests"("decided_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_corrections_pending_key" ON "attendance_correction_requests"("user_id", "work_date", "kind") WHERE (status = 'PENDING');

-- CreateIndex
CREATE UNIQUE INDEX "attendance_correction_requests_user_id_idempotency_key_key" ON "attendance_correction_requests"("user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_created_event_id_fkey" FOREIGN KEY ("created_event_id") REFERENCES "attendance_events"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------- CHECK (SQL tay — hr-extended §3)
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_minute_chk"
  CHECK ("minute_of_day" BETWEEN 0 AND 1439);
-- OUT sau nửa đêm: giờ < 06:00 (giờ chốt ngày công — A#7).
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_next_day_chk"
  CHECK (NOT "next_day" OR ("kind" = 'OUT' AND "minute_of_day" < 360));
-- Lý do bắt buộc khi còn PENDING; NULL được sau hạn lưu D9 (chỉ đơn đã kết thúc).
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_reason_pending_chk"
  CHECK ("reason" IS NOT NULL OR "status" <> 'PENDING');
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_reason_chk"
  CHECK ("reason" IS NULL OR btrim("reason") <> '');
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_note_chk"
  CHECK ("decision_note" IS NULL OR btrim("decision_note") <> '');
-- Người duyệt + giờ duyệt ⇔ APPROVED / REJECTED (CANCELLED do chính người gửi — không có người duyệt).
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_decided_chk"
  CHECK (("status" IN ('APPROVED', 'REJECTED')) = ("decided_by_id" IS NOT NULL AND "decided_at" IS NOT NULL));
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_decision_note_chk"
  CHECK ("decision_note" IS NULL OR "status" IN ('APPROVED', 'REJECTED'));
-- Lượt ADJUSTMENT ⇔ APPROVED.
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_event_chk"
  CHECK (("status" = 'APPROVED') = ("created_event_id" IS NOT NULL));
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_idempotency_chk"
  CHECK (btrim("idempotency_key") <> '');
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_version_chk"
  CHECK ("version" >= 1);
