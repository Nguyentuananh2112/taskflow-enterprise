-- Dữ liệu GIẢ cho diễn tập khôi phục (B2) — không phải dữ liệu thật (repo public, ADR-072).
-- Đủ đa dạng để phép so sánh có ý nghĩa: tiếng Việt (UTF-8), JSONB, inet, NULL, xóa mềm, enum,
-- partial unique index (rank chỉ duy nhất với task chưa xóa), FK kép tasks → projects.
BEGIN;

INSERT INTO users (id, email, password_hash, full_name, token_version, created_at, updated_at, deleted_at)
SELECT gen_random_uuid(), format('drill-user-%s@example.test', g),
       '$argon2id$v=19$m=47104,t=1,p=1$ZHJpbGwtc2FsdA$ZHJpbGwtaGFzaC1ub3QtcmVhbA', -- giả, không phải hash thật
       format('Người dùng diễn tập %s — Đặng Thị Ánh', g), g % 3,
       now() - (g || ' days')::interval, now(), CASE WHEN g % 25 = 0 THEN now() END
FROM generate_series(1, 60) g;

INSERT INTO workspaces (id, name, slug, created_at, updated_at, deleted_at, purge_at)
SELECT gen_random_uuid(), format('Không gian %s', g), format('drill-ws-%s', g), now(), now(),
       CASE WHEN g = 5 THEN now() END, CASE WHEN g = 5 THEN now() + interval '30 days' END
FROM generate_series(1, 5) g;

INSERT INTO workspace_members (id, workspace_id, user_id, role, updated_at)
SELECT gen_random_uuid(), w.id, u.id,
       (ARRAY['OWNER','PM','MEMBER','VIEWER']::"WorkspaceRole"[])[1 + (row_number() OVER ()) % 4],
       now()
FROM (SELECT id, row_number() OVER (ORDER BY slug) AS wn FROM workspaces) w
JOIN (SELECT id, row_number() OVER (ORDER BY email) AS un FROM users) u ON u.un % 5 = w.wn % 5;

INSERT INTO projects (id, workspace_id, name, key_prefix, description, next_task_number, updated_at, archived_at)
SELECT gen_random_uuid(), w.id, format('Dự án %s', p), format('P%s', p), 'Mô tả có dấu: ê ơ ư ă đ',
       101, now(), CASE WHEN p = 2 THEN now() END
FROM workspaces w CROSS JOIN generate_series(1, 2) p;

INSERT INTO tasks (id, workspace_id, project_id, number, title, description, status, priority, rank,
                   version, due_date, assignee_id, created_by_id, deleted_at, updated_at)
SELECT gen_random_uuid(), p.workspace_id, p.id, n, format('Việc số %s', n),
       CASE WHEN n % 3 = 0 THEN NULL ELSE repeat('Nội dung ', n % 7 + 1) END,
       (ARRAY['TODO','IN_PROGRESS','REVIEW','DONE']::"TaskStatus"[])[1 + n % 4],
       (ARRAY['LOW','MEDIUM','HIGH','URGENT']::"TaskPriority"[])[1 + n % 4],
       -- rank trùng được giữa task đã xóa mềm và task sống (partial unique index)
       CASE WHEN n % 10 = 0 THEN format('a%s', n - 1) ELSE format('a%s', n) END,
       1 + n % 5, CASE WHEN n % 4 = 0 THEN current_date + n END,
       (SELECT id FROM users ORDER BY email OFFSET n % 60 LIMIT 1),
       (SELECT id FROM users ORDER BY email OFFSET (n + 7) % 60 LIMIT 1),
       CASE WHEN n % 10 = 0 THEN now() END, now()
FROM projects p CROSS JOIN generate_series(1, 100) n;

INSERT INTO task_audit_logs (id, workspace_id, project_id, task_id, actor_id, action, old_value, new_value, request_id)
SELECT gen_random_uuid(), t.workspace_id, t.project_id, t.id, t.created_by_id,
       (ARRAY['CREATED','UPDATED','STATUS_CHANGED','MOVED','ASSIGNEE_CHANGED']::"TaskAuditAction"[])[1 + t.number % 5],
       jsonb_build_object('title', 'cũ', 'n', t.number), jsonb_build_object('title', t.title, 'tags', jsonb_build_array('a', 'b')),
       format('req-%s', t.number)
FROM tasks t WHERE t.created_by_id IS NOT NULL;

INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at, family_expires_at,
                            revoked_at, revoked_reason, user_agent, ip)
SELECT gen_random_uuid(), u.id, md5(u.email) || md5(u.id::text), gen_random_uuid(),
       now() + interval '7 days', now() + interval '30 days',
       CASE WHEN u.token_version > 0 THEN now() END,
       CASE WHEN u.token_version > 0 THEN 'LOGOUT'::"RefreshTokenRevokeReason" END,
       'Mozilla/5.0 (diễn tập)', '203.0.113.7'::inet
FROM users u;

COMMIT;
