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
