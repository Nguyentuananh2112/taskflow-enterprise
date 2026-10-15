-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'PM', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskAuditAction" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'MOVED', 'ASSIGNEE_CHANGED', 'DELETED');

-- CreateEnum
CREATE TYPE "RefreshTokenRevokeReason" AS ENUM ('ROTATED', 'LOGOUT', 'LOGOUT_ALL', 'REUSE_DETECTED', 'PASSWORD_CHANGED', 'USER_DELETED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "password_changed_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "family_id" UUID NOT NULL,
    "replaced_by_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "family_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" "RefreshTokenRevokeReason",
    "user_agent" VARCHAR(255),
    "ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "purge_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "key_prefix" VARCHAR(10) NOT NULL,
    "description" VARCHAR(2000),
    "next_task_number" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "rank" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "due_date" DATE,
    "assignee_id" UUID,
    "created_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_audit_logs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "TaskAuditAction" NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_id_key" ON "refresh_tokens"("replaced_by_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "workspaces_purge_at_idx" ON "workspaces"("purge_at") WHERE (purge_at IS NOT NULL);

-- CreateIndex
CREATE INDEX "workspaces_deleted_by_id_idx" ON "workspaces"("deleted_by_id");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE INDEX "workspace_members_workspace_id_role_idx" ON "workspace_members"("workspace_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "projects_workspace_id_archived_at_idx" ON "projects"("workspace_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "projects_workspace_id_key_prefix_key" ON "projects"("workspace_id", "key_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_workspace_id_key" ON "projects"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "tasks_assignee_id_idx" ON "tasks"("assignee_id");

-- CreateIndex
CREATE INDEX "tasks_created_by_id_idx" ON "tasks"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_project_id_number_key" ON "tasks"("project_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_rank_live_key" ON "tasks"("project_id", "status", "rank") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "task_audit_logs_task_id_created_at_id_idx" ON "task_audit_logs"("task_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "task_audit_logs_actor_id_idx" ON "task_audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "task_audit_logs_project_id_created_at_idx" ON "task_audit_logs"("project_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_audit_logs" ADD CONSTRAINT "task_audit_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_audit_logs" ADD CONSTRAINT "task_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- SQL VIẾT TAY (T-010) — Prisma 7.10 không mô hình hóa collation cột và CHECK
-- constraint, nên các lệnh dưới đây không gây drift cho `prisma migrate diff`
-- (ADR-062). Không sửa phần sinh tự động ở trên.
-- ============================================================================

-- rank so sánh theo byte để khớp thứ tự của fractional-indexing (ADR-011, data-and-api §1.3).
ALTER TABLE "tasks" ALTER COLUMN "rank" TYPE TEXT COLLATE "C";

-- users: email đã chuẩn hóa ở application (D11) — DB chặn nếu application quên.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email"));
ALTER TABLE "users" ADD CONSTRAINT "users_token_version_chk" CHECK ("token_version" >= 0);

-- workspaces: slug theo R19/ADR-094; xóa mềm luôn đi kèm hạn purge (ADR-047).
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_slug_format_chk"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") >= 3);
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_soft_delete_chk"
  CHECK (("deleted_at" IS NULL) = ("purge_at" IS NULL));

-- projects: tiền tố mã task (R17), bộ đếm số task (FR-03).
ALTER TABLE "projects" ADD CONSTRAINT "projects_key_prefix_format_chk"
  CHECK ("key_prefix" ~ '^[A-Z][A-Z0-9]{1,9}$');
ALTER TABLE "projects" ADD CONSTRAINT "projects_next_task_number_chk" CHECK ("next_task_number" >= 1);

-- tasks: số task, version (ADR-010) và rank không rỗng.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_number_chk" CHECK ("number" >= 1);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_version_chk" CHECK ("version" >= 1);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_rank_not_empty_chk" CHECK ("rank" <> '');
