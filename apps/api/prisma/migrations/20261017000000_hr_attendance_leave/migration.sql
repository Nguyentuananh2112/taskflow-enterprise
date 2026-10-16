-- Mốc 3 (T-037): chấm công & nghỉ phép — attendance-leave.md §3, ADR-119…123.
-- Phần đầu do `prisma migrate diff` sinh; phần cuối là SQL VIẾT TAY (CHECK) mà Prisma 7.10 không mô hình hóa —
-- không gây drift cho `migrate diff --exit-code`.

-- CreateEnum
CREATE TYPE "MemberGrant" AS ENUM ('HR_MANAGE');

-- CreateEnum
CREATE TYPE "AttendanceKind" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('WEB', 'DEVICE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'PERSONAL_PAID', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveDayPart" AS ENUM ('FULL', 'AM', 'PM');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LEAVE_SUBMITTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_CANCELLED', 'LEAVE_REVOKED', 'ATTENDANCE_ADJUSTED', 'HR_GRANTED', 'HR_REVOKED');

-- AlterTable
ALTER TABLE "workspace_members" ADD COLUMN     "grants" "MemberGrant"[] DEFAULT ARRAY[]::"MemberGrant"[];

-- CreateTable
CREATE TABLE "work_schedules" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "workdays" INTEGER NOT NULL,
    "start_min" INTEGER NOT NULL,
    "end_min" INTEGER NOT NULL,
    "break_start_min" INTEGER NOT NULL,
    "break_end_min" INTEGER NOT NULL,
    "grace_min" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "workspace_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("workspace_id","date")
);

-- CreateTable
CREATE TABLE "attendance_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "AttendanceKind" NOT NULL,
    "source" "AttendanceSource" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "work_date" DATE NOT NULL,
    "ip" INET,
    "user_agent" VARCHAR(256),
    "device_id" VARCHAR(64),
    "idempotency_key" VARCHAR(64),
    "note" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(500),

    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "LeaveType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "day_part" "LeaveDayPart" NOT NULL DEFAULT 'FULL',
    "reason" VARCHAR(1000) NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "entitled_days" DECIMAL(4,1) NOT NULL DEFAULT 12,
    "adjustment_days" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("workspace_id","user_id","year")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "ref_id" UUID NOT NULL,
    "actor_id" UUID,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_audit_logs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "target_user_id" UUID,
    "ref_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_schedules_created_by_id_idx" ON "work_schedules"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_schedules_workspace_id_effective_from_key" ON "work_schedules"("workspace_id", "effective_from");

-- CreateIndex
CREATE INDEX "attendance_events_workspace_id_work_date_idx" ON "attendance_events"("workspace_id", "work_date");

-- CreateIndex
CREATE INDEX "attendance_events_workspace_id_user_id_work_date_idx" ON "attendance_events"("workspace_id", "user_id", "work_date");

-- CreateIndex
CREATE INDEX "attendance_events_user_id_idx" ON "attendance_events"("user_id");

-- CreateIndex
CREATE INDEX "attendance_events_created_by_id_idx" ON "attendance_events"("created_by_id");

-- CreateIndex
CREATE INDEX "attendance_events_voided_by_id_idx" ON "attendance_events"("voided_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_events_web_in_once_key" ON "attendance_events"("workspace_id", "user_id", "work_date") WHERE (kind = 'IN' AND source = 'WEB' AND voided_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_events_idempotency_key" ON "attendance_events"("workspace_id", "user_id", "source", "idempotency_key") WHERE (idempotency_key IS NOT NULL);

-- CreateIndex
CREATE INDEX "leave_requests_workspace_id_status_idx" ON "leave_requests"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_workspace_id_user_id_start_date_idx" ON "leave_requests"("workspace_id", "user_id", "start_date");

-- CreateIndex
CREATE INDEX "leave_requests_user_id_idx" ON "leave_requests"("user_id");

-- CreateIndex
CREATE INDEX "leave_requests_decided_by_id_idx" ON "leave_requests"("decided_by_id");

-- CreateIndex
CREATE INDEX "leave_balances_user_id_idx" ON "leave_balances"("user_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_workspace_id_idx" ON "notifications"("workspace_id");

-- CreateIndex
CREATE INDEX "notifications_actor_id_idx" ON "notifications"("actor_id");

-- CreateIndex
CREATE INDEX "hr_audit_logs_workspace_id_created_at_id_idx" ON "hr_audit_logs"("workspace_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "hr_audit_logs_actor_id_idx" ON "hr_audit_logs"("actor_id");

-- AddForeignKey
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_audit_logs" ADD CONSTRAINT "hr_audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_audit_logs" ADD CONSTRAINT "hr_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================================
-- SQL VIẾT TAY (T-037)
-- =====================================================================================================

-- ADR-119 / B-M2: OWNER có mọi quyền qua role ⇒ KHÔNG lưu grant (hạ OWNER không để sót HR ngầm);
-- VIEWER không được cấp grant (422 ở app). Đổi role sang OWNER / VIEWER phải xóa grants trong CÙNG câu
-- UPDATE — CHECK này là chốt chặn cuối nếu app quên.
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_grants_role_chk"
  CHECK ("role" NOT IN ('OWNER', 'VIEWER') OR cardinality(COALESCE("grants", ARRAY[]::"MemberGrant"[])) = 0);

-- ADR-120: lịch làm việc — phút trong ngày theo `timezone`; ca: start ≤ breakStart ≤ breakEnd ≤ end.
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_workdays_chk" CHECK ("workdays" BETWEEN 1 AND 127);
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_times_chk"
  CHECK (0 <= "start_min" AND "start_min" <= "break_start_min" AND "break_start_min" <= "break_end_min"
         AND "break_end_min" <= "end_min" AND "end_min" <= 1440 AND "start_min" < "end_min");
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_grace_chk" CHECK ("grace_min" BETWEEN 0 AND 240);

-- ADR-121: hủy lượt chấm phải ghi đủ ai / khi nào / vì sao; lượt ADJUSTMENT bắt buộc lý do (note).
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_void_chk"
  CHECK (("voided_at" IS NULL) = ("voided_by_id" IS NULL) AND ("voided_at" IS NULL OR "void_reason" IS NOT NULL));
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_adjustment_note_chk"
  CHECK ("source" <> 'ADJUSTMENT' OR "note" IS NOT NULL);

-- ADR-122: khoảng ngày hợp lệ; nửa ngày chỉ khi một ngày; không vắt qua 2 năm (v1); quyết định đủ cặp.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_range_chk" CHECK ("end_date" >= "start_date");
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_day_part_chk"
  CHECK ("day_part" = 'FULL' OR "start_date" = "end_date");
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_same_year_chk"
  CHECK (date_part('year', "start_date") = date_part('year', "end_date"));
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_chk"
  CHECK (("decided_by_id" IS NULL) = ("decided_at" IS NULL));
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_version_chk" CHECK ("version" >= 1);

ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_year_chk" CHECK ("year" BETWEEN 2000 AND 2100);
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_entitled_chk" CHECK ("entitled_days" >= 0);
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_version_chk" CHECK ("version" >= 1);

-- KHÔNG seed lịch, KHÔNG trigger (Tech Lead, T-037): lịch mặc định là MỘT hằng số trong domain attendance
-- (không có phiên bản nào effective_from ≤ ngày ⇒ mặc định). Dòng work_schedules chỉ sinh khi HR lưu lịch.
