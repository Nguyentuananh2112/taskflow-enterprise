-- Seed dữ liệu tải T-027 — chạy bằng psql TRÊN DB RIÊNG (ADR-106), user taskflow_migrator, SAU `prisma migrate deploy`:
--   psql "$MIGRATOR_URL" -v ws=5 -v proj=3 -v tasks=500 -v users=20 -v rproj=2 -v rtasks=500 -v pw_hash='…' -f load/seed/seed.sql
-- (load/run.sh làm sẵn). Mặc định ticket: 5 workspace × 3 project × 500 task, 20 user/workspace (100 user).
-- Mọi user dùng chung mật khẩu test `load-test-only-Kanban-2026` (hash argon2id OWASP — ADR-065; KHÔNG phải secret).
-- Ghi thẳng SQL (không qua HTTP): nhanh và không vướng rate limit register 5/giờ/IP.
\set ON_ERROR_STOP on

-- psql KHÔNG thay :biến bên trong khối $$ ⇒ chuyển qua set_config rồi đọc bằng current_setting.
SELECT set_config('tf.rtasks', :'rtasks', false) \gset
DO $$
BEGIN
  IF current_database() NOT LIKE 'taskflow\_t027%' AND current_database() NOT LIKE 'taskflow\_load%' THEN
    RAISE EXCEPTION 'Seed tải chỉ chạy trên DB taskflow_t027* / taskflow_load* (ADR-106) — đang ở %', current_database();
  END IF;
  IF current_setting('tf.rtasks')::int > 610 THEN
    RAISE EXCEPTION 'rtasks tối đa 610 (10 × 61 khóa rank dài liền kề)';
  END IF;
END $$;

BEGIN;
TRUNCATE task_audit_logs, tasks, projects, workspace_members, refresh_tokens, workspaces, users CASCADE;

-- Khóa id trước (uuid v7 do app sinh — DB không có DEFAULT, PG18 có uuidv7()).
CREATE TEMP TABLE t_ws ON COMMIT DROP AS
  SELECT w, uuidv7() AS id FROM generate_series(1, :ws) AS w;
CREATE TEMP TABLE t_user ON COMMIT DROP AS
  SELECT w, u, uuidv7() AS id FROM generate_series(1, :ws) AS w, generate_series(1, :users) AS u;
CREATE TEMP TABLE t_proj ON COMMIT DROP AS
  SELECT w, p, uuidv7() AS id FROM generate_series(1, :ws) AS w, generate_series(1, :proj) AS p;

-- Email: load.w<w>.u<u>@example.test (k6 suy ra theo VU). u=1 là OWNER, còn lại MEMBER (đủ quyền
-- tạo/sửa/move theo ADR-041).
INSERT INTO users (id, email, password_hash, full_name, created_at, updated_at)
SELECT id, format('load.w%s.u%s@example.test', w, u), :'pw_hash', format('Load W%s U%s', w, u), now(), now()
FROM t_user;

INSERT INTO workspaces (id, name, slug, created_at, updated_at)
SELECT id, format('Load workspace %s', w), format('load-ws-%s', w), now(), now() FROM t_ws;

INSERT INTO workspace_members (id, workspace_id, user_id, role, joined_at, updated_at)
SELECT uuidv7(), ws.id, us.id,
       (CASE WHEN us.u = 1 THEN 'OWNER' ELSE 'MEMBER' END)::"WorkspaceRole", now(), now()
FROM t_user us JOIN t_ws ws USING (w);

INSERT INTO projects (id, workspace_id, name, key_prefix, next_task_number, created_at, updated_at)
SELECT pr.id, ws.id, format('Load project %s-%s', pr.w, pr.p), format('P%s', pr.p), :tasks + 1, now(), now()
FROM t_proj pr JOIN t_ws ws USING (w);

-- Task: trạng thái xoay vòng 4 cột (~125 task/cột). rank = 'b' + 2 chữ số base62 — khóa hợp lệ của
-- fractional-indexing (phần nguyên 'b' ⇒ 2 ký tự), tăng dần theo collation "C" (ADR-011/062).
INSERT INTO tasks (id, workspace_id, project_id, number, title, description, status, priority, rank,
                   version, assignee_id, created_by_id, created_at, updated_at)
SELECT uuidv7(), ws.id, pr.id, n,
       format('Load task %s', n),
       CASE WHEN n % 3 = 0 THEN repeat('Mô tả dữ liệu tải. ', 10) END,
       (ARRAY['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'])[(n - 1) % 4 + 1]::"TaskStatus",
       (ARRAY['LOW', 'MEDIUM', 'HIGH', 'URGENT'])[n % 4 + 1]::"TaskPriority",
       'b' || substr(d.digits, ((n - 1) / 4) / 62 + 1, 1) || substr(d.digits, ((n - 1) / 4) % 62 + 1, 1),
       1,
       CASE WHEN n % 5 = 0 THEN NULL ELSE assignee.id END,
       owner.id, now(), now()
FROM t_proj pr
JOIN t_ws ws USING (w)
CROSS JOIN generate_series(1, :tasks) AS n
CROSS JOIN (SELECT '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'::text AS digits) AS d
JOIN t_user owner ON owner.w = pr.w AND owner.u = 1
JOIN t_user assignee ON assignee.w = pr.w AND assignee.u = (n % :users) + 1;

-- Kịch bản rebalance (T-027 bổ sung, T-033): :rproj project "R<n>"/workspace, MỖI cột 4 trạng thái có
-- :rtasks task với rank DÀI 64 ký tự và liền kề: 'a0' + 60×'V' + chữ số 0–9 + chữ số 1–z (phần thập phân
-- không tận cùng bằng '0' — đúng định dạng fractional-indexing; tăng dần theo collation "C").
-- Move chen giữa 2 task liền kề ⇒ rank mới 65 ký tự > ngưỡng 64 ⇒ rebalance cả cột trong lệnh move.
CREATE TEMP TABLE t_rproj ON COMMIT DROP AS
  SELECT w, p, uuidv7() AS id FROM generate_series(1, :ws) AS w, generate_series(1, :rproj) AS p;

INSERT INTO projects (id, workspace_id, name, key_prefix, next_task_number, created_at, updated_at)
SELECT rp.id, ws.id, format('Rebalance %s-%s', rp.w, rp.p), format('R%s', rp.p), 4 * :rtasks + 1, now(), now()
FROM t_rproj rp JOIN t_ws ws USING (w);

INSERT INTO tasks (id, workspace_id, project_id, number, title, status, priority, rank, version,
                   created_by_id, created_at, updated_at)
SELECT uuidv7(), ws.id, rp.id, (s.i - 1) * :rtasks + k,
       format('Rebalance task %s', k),
       s.status::"TaskStatus", 'MEDIUM'::"TaskPriority",
       'a0' || repeat('V', 60) || substr('0123456789', (k - 1) / 61 + 1, 1)
            || substr(d.tail, (k - 1) % 61 + 1, 1),
       1, owner.id, now(), now()
FROM t_rproj rp
JOIN t_ws ws USING (w)
CROSS JOIN (VALUES (1, 'TODO'), (2, 'IN_PROGRESS'), (3, 'REVIEW'), (4, 'DONE')) AS s(i, status)
CROSS JOIN generate_series(1, :rtasks) AS k
CROSS JOIN (SELECT '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'::text AS tail) AS d
JOIN t_user owner ON owner.w = rp.w AND owner.u = 1;

COMMIT;

ANALYZE;

SELECT format('[seed] %s user · %s workspace · %s project · %s task',
              (SELECT count(*) FROM users), (SELECT count(*) FROM workspaces),
              (SELECT count(*) FROM projects), (SELECT count(*) FROM tasks)) AS result;
