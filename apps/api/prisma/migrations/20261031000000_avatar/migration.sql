-- Mốc 6 — ảnh đại diện (docs/design/avatar-chat.md ADR-142; T-068). TÁCH theo vé (TL 18/10): bảng chat ở migration
-- của T-069. Timestamp thư mục đặt lúc merge (ADR-148). Blob ở kho tệp `avatars/<userId>/<version>/{256,64}` —
-- `avatar_version` là cột DUY NHẤT thêm vào `users`; NULL = không có ảnh (hiện chữ cái).

-- AlterTable
ALTER TABLE "users" ADD COLUMN "avatar_version" INTEGER;

-- CHECK (SQL tay): version đơn điệu bắt đầu từ 1 — khớp regex khóa avatar `[1-9][0-9]{0,8}` của core/files.
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_version_positive_chk"
  CHECK ("avatar_version" IS NULL OR "avatar_version" BETWEEN 1 AND 999999999);
