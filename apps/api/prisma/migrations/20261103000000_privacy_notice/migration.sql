-- T-075 — Thông báo quyền riêng tư (data-retention.md §5; TL chốt thay Q3/Q4 của R27).
-- users: phiên bản thông báo đã xác nhận + đồng ý xử lý lý do nghỉ. companies: đầu mối liên hệ.

ALTER TABLE "users"
  ADD COLUMN "privacy_ack_version" INTEGER,
  ADD COLUMN "privacy_ack_at" TIMESTAMPTZ(3),
  ADD COLUMN "consent_leave_reason" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "consent_leave_reason_at" TIMESTAMPTZ(3);

-- Phiên bản xác nhận dương; có phiên bản ⇔ có thời điểm.
ALTER TABLE "users" ADD CONSTRAINT "users_privacy_ack_chk" CHECK (
  ("privacy_ack_version" IS NULL AND "privacy_ack_at" IS NULL)
  OR ("privacy_ack_version" > 0 AND "privacy_ack_at" IS NOT NULL)
);

ALTER TABLE "companies" ADD COLUMN "privacy_contact" VARCHAR(200);

-- Bằng chứng đồng ý (NĐ 13/2023 Đ.11 — soát B M1, TL chốt): bảng CHỈ THÊM, ghi cùng transaction với cột trạng thái.
CREATE TYPE "privacy_consent_kind" AS ENUM ('ACK', 'LEAVE_REASON');

CREATE TABLE "privacy_consent_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "privacy_consent_kind" NOT NULL,
    "value" BOOLEAN NOT NULL,
    "notice_version" INTEGER NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "request_id" VARCHAR(64),

    CONSTRAINT "privacy_consent_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "privacy_consent_events_notice_version_chk" CHECK ("notice_version" > 0),
    -- Xác nhận đã đọc luôn là true (không có "bỏ xác nhận").
    CONSTRAINT "privacy_consent_events_ack_true_chk" CHECK ("kind" <> 'ACK' OR "value")
);

CREATE INDEX "privacy_consent_events_user_id_at_idx" ON "privacy_consent_events"("user_id", "at");
CREATE INDEX "privacy_consent_events_at_idx" ON "privacy_consent_events"("at");

ALTER TABLE "privacy_consent_events" ADD CONSTRAINT "privacy_consent_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Chỉ thêm THẬT (soát B L1): cấm UPDATE ở DB; DELETE chỉ để bước retention D16.
CREATE FUNCTION "privacy_consent_events_no_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'privacy_consent_events là bảng chỉ thêm — không sửa sự kiện';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "privacy_consent_events_immutable"
  BEFORE UPDATE ON "privacy_consent_events"
  FOR EACH ROW EXECUTE FUNCTION "privacy_consent_events_no_update"();
