-- T-037b: nhiệm kỳ thành viên (bảng công không tính "Vắng" ngoài nhiệm kỳ) + lý do nghỉ TÙY CHỌN.

-- CreateEnum
CREATE TYPE "MemberDepartureReason" AS ENUM ('REMOVED', 'LEFT');

-- AlterTable
ALTER TABLE "leave_requests" ALTER COLUMN "reason" DROP NOT NULL;

-- CreateTable
CREATE TABLE "workspace_member_departures" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL,
    "left_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" "MemberDepartureReason" NOT NULL,

    CONSTRAINT "workspace_member_departures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_member_departures_workspace_id_left_at_idx" ON "workspace_member_departures"("workspace_id", "left_at");

-- CreateIndex
CREATE INDEX "workspace_member_departures_workspace_id_user_id_idx" ON "workspace_member_departures"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "workspace_member_departures_user_id_idx" ON "workspace_member_departures"("user_id");

-- AddForeignKey
ALTER TABLE "workspace_member_departures" ADD CONSTRAINT "workspace_member_departures_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_member_departures" ADD CONSTRAINT "workspace_member_departures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Lý do nghỉ tùy chọn: "không có lý do" chỉ có MỘT biểu diễn là NULL (chuỗi rỗng / khoảng trắng bị chặn).
UPDATE "leave_requests" SET "reason" = NULL WHERE btrim("reason") = '';
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reason_not_blank_chk"
  CHECK ("reason" IS NULL OR btrim("reason") <> '');

-- Nhiệm kỳ đã kết thúc phải có độ dài không âm.
ALTER TABLE "workspace_member_departures" ADD CONSTRAINT "workspace_member_departures_range_chk"
  CHECK ("left_at" >= "joined_at");
