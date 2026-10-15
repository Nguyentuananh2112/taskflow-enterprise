-- Phân tích sau khi chạy tải (T-027). Postgres của run.sh bật pg_stat_statements; chạy bằng superuser.
\set ON_ERROR_STOP on
\pset pager off

\echo '== Top 10 truy vấn theo tổng thời gian (pg_stat_statements) =='
SELECT round(total_exec_time::numeric, 1) AS total_ms,
       calls,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       round((100 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0))::numeric, 1) AS cache_hit_pct,
       left(regexp_replace(query, '\s+', ' ', 'g'), 220) AS query
FROM pg_stat_statements
WHERE query !~* '^(BEGIN|COMMIT|SET|SHOW|SELECT 1)'
ORDER BY total_exec_time DESC
LIMIT 10;

\echo '== Top 5 theo thời gian trung bình (calls >= 50) =='
SELECT round(mean_exec_time::numeric, 2) AS mean_ms, calls,
       left(regexp_replace(query, '\s+', ' ', 'g'), 220) AS query
FROM pg_stat_statements
WHERE calls >= 50
ORDER BY mean_exec_time DESC
LIMIT 5;

-- Truy vấn đọc board tương đương (một cột của một project, theo rank) — hình dạng giống Query handler
-- (data-and-api §2: lọc tenant + deleted_at IS NULL, sắp theo rank COLLATE "C", kèm assignee/createdBy).
\echo '== EXPLAIN ANALYZE: đọc một cột board (200 task) =='
SELECT p.workspace_id AS ws, p.id AS pj FROM projects p ORDER BY p.created_at LIMIT 1 \gset
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT t.id, t.number, t.title, t.description, t.status, t.priority, t.rank, t.version, t.due_date,
       a.id AS assignee_id, a.full_name AS assignee_name, c.id AS creator_id, c.full_name AS creator_name,
       t.created_at, t.updated_at
FROM tasks t
LEFT JOIN users a ON a.id = t.assignee_id
LEFT JOIN users c ON c.id = t.created_by_id
WHERE t.workspace_id = :'ws' AND t.project_id = :'pj' AND t.status = 'TODO' AND t.deleted_at IS NULL
ORDER BY t.rank
LIMIT 200;

\echo '== EXPLAIN ANALYZE: cả board (mọi cột) =='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT t.id, t.status, t.rank, t.version
FROM tasks t
WHERE t.workspace_id = :'ws' AND t.project_id = :'pj' AND t.deleted_at IS NULL
ORDER BY t.status, t.rank;

\echo '== Kích thước bảng / index =='
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total, n_live_tup
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8;
