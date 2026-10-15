#!/usr/bin/env bash
# Chạy MỘT lần khi volume Postgres còn trống (docker-entrypoint-initdb.d). Chỉ cho local/test/CI.
# Tách quyền (ADR-074, devops.md §4.1):
#   taskflow_migrator — sở hữu DB + schema, chạy `prisma migrate` (cần CREATEDB cho shadow DB của migrate dev/diff
#                       và để clone DB từ template cho test).
#   taskflow_app      — chỉ DML; bảng/sequence do migrator tạo tự cấp quyền qua DEFAULT PRIVILEGES.
# Áp cho $POSTGRES_DB và mọi DB trong TASKFLOW_EXTRA_DBS (cách nhau bởi khoảng trắng; tạo mới, owner migrator).
set -euo pipefail

: "${TASKFLOW_MIGRATOR_PASSWORD:?thiếu TASKFLOW_MIGRATOR_PASSWORD}"
: "${TASKFLOW_APP_PASSWORD:?thiếu TASKFLOW_APP_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_pw="$TASKFLOW_MIGRATOR_PASSWORD" \
  -v app_pw="$TASKFLOW_APP_PASSWORD" <<'SQL'
CREATE ROLE taskflow_migrator LOGIN CREATEDB PASSWORD :'migrator_pw';
CREATE ROLE taskflow_app LOGIN PASSWORD :'app_pw';
ALTER ROLE taskflow_app SET statement_timeout = '10s';
SQL

setup_db() {
  local db="$1"
  if [ "$db" != "$POSTGRES_DB" ]; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v db="$db" <<'SQL'
CREATE DATABASE :"db" OWNER taskflow_migrator;
SQL
  fi
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" -v db="$db" <<'SQL'
ALTER DATABASE :"db" OWNER TO taskflow_migrator;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO taskflow_app;

ALTER SCHEMA public OWNER TO taskflow_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO taskflow_app;

ALTER DEFAULT PRIVILEGES FOR ROLE taskflow_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taskflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE taskflow_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO taskflow_app;
SQL
  echo "[init] database ${db}: owner taskflow_migrator, DML cho taskflow_app"
}

# shellcheck disable=SC2086 # cố ý tách theo khoảng trắng
for db in "$POSTGRES_DB" ${TASKFLOW_EXTRA_DBS:-}; do
  setup_db "$db"
done
