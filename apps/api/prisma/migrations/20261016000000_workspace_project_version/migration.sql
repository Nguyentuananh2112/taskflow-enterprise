-- ADR-110 (T-032): optimistic lock cho Workspace và Project — mọi ghi là UPDATE … WHERE version.
-- Chống lost update: PATCH ‖ DELETE workspace làm workspace đã xóa hồi sinh (X2), rename ‖ archive
-- project gỡ archive (X8). `next_task_number` (allocateTaskNumber) KHÔNG tăng version.
ALTER TABLE "workspaces" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "projects" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_version_chk" CHECK ("version" >= 1);
ALTER TABLE "projects" ADD CONSTRAINT "projects_version_chk" CHECK ("version" >= 1);
