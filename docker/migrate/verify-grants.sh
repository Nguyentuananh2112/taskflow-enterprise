#!/usr/bin/env bash
# Kiểm quyền sau deploy trên DB MỚI TINH (lỗi deploy đầu tiên mà E phát hiện — T-027 bổ sung):
#   DB mới → migrate (+ grant-app.sql) bằng taskflow_migrator → taskflow_app đọc/ghi ĐƯỢC, DDL KHÔNG được.
# Dùng psql (CI runner có sẵn). Biến: PGHOST, PGPORT, MIGRATOR_PASSWORD, APP_PASSWORD;
#   MIGRATE_IMAGE + DOCKER_NETWORK + DB_HOST_IN_NETWORK ⇒ deploy bằng image migrate thay vì `pnpm … db:deploy`.
set -euo pipefail

: "${PGHOST:=127.0.0.1}" "${PGPORT:=5432}"
: "${MIGRATOR_PASSWORD:?thiếu MIGRATOR_PASSWORD}" "${APP_PASSWORD:?thiếu APP_PASSWORD}"
DB="taskflow_grants_$(date +%s)_$$"
MIGRATOR_URL="postgresql://taskflow_migrator:${MIGRATOR_PASSWORD}@${PGHOST}:${PGPORT}"
APP_URL="postgresql://taskflow_app:${APP_PASSWORD}@${PGHOST}:${PGPORT}/${DB}"

cleanup() { psql "$MIGRATOR_URL/postgres" -qc "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
fail() { echo "GRANTS FAIL: $*" >&2; exit 1; }

psql "$MIGRATOR_URL/postgres" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$DB\"" # DB mới: KHÔNG có default privileges
if [ -n "${MIGRATE_IMAGE:-}" ]; then
  docker run --rm --network "${DOCKER_NETWORK:?}" \
    -e DATABASE_URL="postgresql://taskflow_migrator:${MIGRATOR_PASSWORD}@${DB_HOST_IN_NETWORK:?}:5432/${DB}" \
    "$MIGRATE_IMAGE"
else
  DATABASE_URL="$MIGRATOR_URL/$DB" pnpm --filter @taskflow/api run db:deploy
fi

# Đọc + ghi (trong transaction rồi rollback — không để lại dữ liệu).
psql "$APP_URL" -v ON_ERROR_STOP=1 -q <<'SQL' || fail "taskflow_app không đọc/ghi được bảng sau migrate"
BEGIN;
SELECT count(*) FROM tasks;
INSERT INTO users (id, email, password_hash, full_name, updated_at)
VALUES (uuidv7(), 'grants-probe@example.test', 'x', 'probe', now());
UPDATE users SET full_name = 'probe2' WHERE email = 'grants-probe@example.test';
DELETE FROM users WHERE email = 'grants-probe@example.test';
ROLLBACK;
SQL
echo "ok  taskflow_app: SELECT/INSERT/UPDATE/DELETE"

for ddl in 'CREATE TABLE grants_probe (x int)' 'DROP TABLE tasks' 'ALTER TABLE tasks ADD COLUMN x int' 'TRUNCATE tasks'; do
  if psql "$APP_URL" -v ON_ERROR_STOP=1 -qc "$ddl" >/dev/null 2>&1; then fail "taskflow_app chạy được DDL: $ddl"; fi
done
echo "ok  taskflow_app: CREATE/DROP/ALTER/TRUNCATE bị từ chối"

# Chạy deploy lần 2 phải idempotent (không lỗi).
if [ -z "${MIGRATE_IMAGE:-}" ]; then
  DATABASE_URL="$MIGRATOR_URL/$DB" pnpm --filter @taskflow/api run db:deploy >/dev/null
  echo "ok  db:deploy lần 2 idempotent"
fi
echo "GRANTS PASS ($DB)"
