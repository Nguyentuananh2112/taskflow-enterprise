-- Mốc 3.5 — cấp công ty (docs/design/company-level.md, ADR-133…140; T-061).
-- ADR-138: chưa production ⇒ KHÔNG giữ dữ liệu HR của Mốc 3 (chấm công, đơn nghỉ, số dư, lịch, ngày lễ, thông báo,
-- HrAuditLog). Xóa sạch TRƯỚC khi bỏ `workspace_id` / đổi khóa chính / đổi enum NotificationType (dòng cũ của nhiều
-- workspace sẽ trùng khóa mới; HR_GRANTED/HR_REVOKED không còn trong enum). Các CHECK cũ của các bảng này giữ nguyên.
TRUNCATE TABLE "work_schedules", "holidays", "attendance_events", "leave_requests", "leave_balances",
  "notifications", "hr_audit_logs", "workspace_member_departures";

-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "CompanyGrant" AS ENUM ('HR_MANAGE', 'PAYROLL_MANAGE');

-- CreateEnum
CREATE TYPE "DepartureReason" AS ENUM ('OFFBOARDED', 'ROLE_CHANGED');

-- AlterEnum
ALTER TYPE "RefreshTokenRevokeReason" ADD VALUE 'OFFBOARDED';

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('LEAVE_SUBMITTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_CANCELLED', 'LEAVE_REVOKED', 'ATTENDANCE_ADJUSTED', 'ACCESS_CHANGED', 'OFFBOARD_SCHEDULED', 'OFFBOARD_CLEANUP');
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "NotificationType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "workspace_member_departures" DROP CONSTRAINT "workspace_member_departures_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "workspace_member_departures" DROP CONSTRAINT "workspace_member_departures_user_id_fkey";

-- DropForeignKey
ALTER TABLE "work_schedules" DROP CONSTRAINT "work_schedules_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "holidays" DROP CONSTRAINT "holidays_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "attendance_events" DROP CONSTRAINT "attendance_events_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "leave_balances" DROP CONSTRAINT "leave_balances_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "hr_audit_logs" DROP CONSTRAINT "hr_audit_logs_workspace_id_fkey";

-- DropIndex
DROP INDEX "work_schedules_workspace_id_effective_from_key";

-- DropIndex
DROP INDEX "attendance_events_workspace_id_work_date_idx";

-- DropIndex
DROP INDEX "attendance_events_workspace_id_user_id_work_date_idx";

-- DropIndex
DROP INDEX "attendance_events_user_id_idx";

-- DropIndex
DROP INDEX "attendance_events_web_in_once_key";

-- DropIndex
DROP INDEX "attendance_events_idempotency_key";

-- DropIndex
DROP INDEX "leave_requests_workspace_id_status_idx";

-- DropIndex
DROP INDEX "leave_requests_workspace_id_user_id_start_date_idx";

-- DropIndex
DROP INDEX "leave_requests_user_id_idx";

-- DropIndex
DROP INDEX "leave_balances_user_id_idx";

-- DropIndex
DROP INDEX "notifications_workspace_id_idx";

-- DropIndex
DROP INDEX "hr_audit_logs_workspace_id_created_at_id_idx";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "archived_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "workspace_members" DROP COLUMN "grants";

-- AlterTable
ALTER TABLE "work_schedules" DROP COLUMN "workspace_id";

-- AlterTable
ALTER TABLE "holidays" DROP CONSTRAINT "holidays_pkey",
DROP COLUMN "workspace_id",
ADD CONSTRAINT "holidays_pkey" PRIMARY KEY ("date");

-- AlterTable
ALTER TABLE "attendance_events" DROP COLUMN "workspace_id";

-- AlterTable
ALTER TABLE "leave_requests" DROP COLUMN "workspace_id";

-- AlterTable
ALTER TABLE "leave_balances" DROP CONSTRAINT "leave_balances_pkey",
DROP COLUMN "workspace_id",
ADD CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("user_id", "year");

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "workspace_id";

-- AlterTable
ALTER TABLE "hr_audit_logs" DROP COLUMN "workspace_id",
ALTER COLUMN "actor_id" DROP NOT NULL;

-- DropTable
DROP TABLE "workspace_member_departures";

-- DropEnum
DROP TYPE "MemberGrant";

-- DropEnum
DROP TYPE "MemberDepartureReason";

-- CreateTable
CREATE TABLE "companies" (
    "id" SMALLINT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_members" (
    "user_id" UUID NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "grants" "CompanyGrant"[] DEFAULT ARRAY[]::"CompanyGrant"[],
    "start_date" DATE,
    "offboard_last_day" DATE,
    "offboard_access_until" TIMESTAMPTZ(3),
    "offboard_scheduled_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_members_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "company_member_departures" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "first_day" DATE NOT NULL,
    "last_day" DATE NOT NULL,
    "left_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" "DepartureReason" NOT NULL,

    CONSTRAINT "company_member_departures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_activation_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_activation_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_members_offboard_access_until_idx" ON "company_members"("offboard_access_until") WHERE (offboard_access_until IS NOT NULL);

-- CreateIndex
CREATE INDEX "company_members_role_idx" ON "company_members"("role");

-- CreateIndex
CREATE INDEX "company_members_offboard_scheduled_by_id_idx" ON "company_members"("offboard_scheduled_by_id");

-- CreateIndex
CREATE INDEX "company_member_departures_user_id_idx" ON "company_member_departures"("user_id");

-- CreateIndex
CREATE INDEX "company_member_departures_last_day_idx" ON "company_member_departures"("last_day");

-- CreateIndex
CREATE UNIQUE INDEX "account_activation_tokens_token_hash_key" ON "account_activation_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "account_activation_tokens_expires_at_idx" ON "account_activation_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "account_activation_tokens_created_by_id_idx" ON "account_activation_tokens"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_activation_tokens_live_key" ON "account_activation_tokens"("user_id") WHERE (used_at IS NULL AND revoked_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "work_schedules_effective_from_key" ON "work_schedules"("effective_from");

-- CreateIndex
CREATE INDEX "attendance_events_work_date_idx" ON "attendance_events"("work_date");

-- CreateIndex
CREATE INDEX "attendance_events_user_id_work_date_idx" ON "attendance_events"("user_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_events_web_in_once_key" ON "attendance_events"("user_id", "work_date") WHERE (kind = 'IN' AND source = 'WEB' AND voided_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_events_idempotency_key" ON "attendance_events"("user_id", "source", "idempotency_key") WHERE (idempotency_key IS NOT NULL);

-- CreateIndex
CREATE INDEX "leave_requests_status_start_date_id_idx" ON "leave_requests"("status", "start_date", "id");

-- CreateIndex
CREATE INDEX "leave_requests_status_created_at_id_idx" ON "leave_requests"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "leave_requests_user_id_start_date_idx" ON "leave_requests"("user_id", "start_date");

-- CreateIndex
CREATE INDEX "hr_audit_logs_created_at_id_idx" ON "hr_audit_logs"("created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_offboard_scheduled_by_id_fkey" FOREIGN KEY ("offboard_scheduled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_member_departures" ADD CONSTRAINT "company_member_departures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_activation_tokens" ADD CONSTRAINT "account_activation_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_activation_tokens" ADD CONSTRAINT "account_activation_tokens_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------- CHECK (SQL tay — company-level.md §3)

-- Đúng một công ty.
ALTER TABLE "companies" ADD CONSTRAINT "companies_single_row_chk" CHECK ("id" = 1);
ALTER TABLE "companies" ADD CONSTRAINT "companies_name_not_blank_chk" CHECK (btrim("name") <> '');

-- Nhiệm kỳ chấm công = thời gian là EMPLOYEE: chỉ EMPLOYEE có start_date; Admin đã có mọi quyền ⇒ không grant.
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_start_date_chk"
  CHECK (("role" = 'EMPLOYEE') = ("start_date" IS NOT NULL));
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_grants_role_chk"
  CHECK ("role" = 'EMPLOYEE' OR cardinality("grants") = 0);
-- Lịch nghỉ: ba cột cùng có hoặc cùng không.
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_offboard_chk"
  CHECK (("offboard_last_day" IS NULL) = ("offboard_access_until" IS NULL)
     AND ("offboard_last_day" IS NULL) = ("offboard_scheduled_by_id" IS NULL));
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_version_chk" CHECK ("version" >= 1);

ALTER TABLE "company_member_departures" ADD CONSTRAINT "company_member_departures_range_chk"
  CHECK ("last_day" >= "first_day");

ALTER TABLE "account_activation_tokens" ADD CONSTRAINT "account_activation_tokens_hash_chk"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "account_activation_tokens" ADD CONSTRAINT "account_activation_tokens_used_or_revoked_chk"
  CHECK ("used_at" IS NULL OR "revoked_at" IS NULL);

-- ---------------------------------------------------------------- backfill (ADR-138)
-- Mọi tài khoản chưa xóa ⇒ nhân viên, để DB dev / CI có sẵn user vẫn đăng nhập được sau migrate. Không tạo Admin,
-- không tạo dòng `companies` — chạy `admin:bootstrap`. Ngày đầu nhiệm kỳ = ngày tạo tài khoản (giờ VN).
INSERT INTO "company_members" ("user_id", "role", "start_date", "updated_at")
SELECT "id", 'EMPLOYEE', ("created_at" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, now()
  FROM "users"
 WHERE "deleted_at" IS NULL;
