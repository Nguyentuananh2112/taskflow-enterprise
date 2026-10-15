#!/usr/bin/env bash
# Chạy MỘT lần khi volume Postgres còn trống (docker-entrypoint-initdb.d). Chỉ cho local/test.
# Tách quyền (ADR-074, devops.md §4.1):
#   taskflow_migrator — sở hữu DB + schema, chạy `prisma migrate` (cần CREATEDB cho shadow DB của migrate dev/diff).
#   taskflow_app      — chỉ DML; bảng/sequence do migrator tạo tự cấp quyền qua DEFAULT PRIVILEGES.
set -euo pipefail

: "${TASKFLOW_MIGRATOR_PASSWORD:?thiếu TASKFLOW_MIGRATOR_PASSWORD}"
: "${TASKFLOW_APP_PASSWORD:?thiếu TASKFLOW_APP_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v migrator_pw="$TASKFLOW_MIGRATOR_PASSWORD" \
  -v app_pw="$TASKFLOW_APP_PASSWORD" <<'SQL'
CREATE ROLE taskflow_migrator LOGIN CREATEDB PASSWORD :'migrator_pw';
CREATE ROLE taskflow_app LOGIN PASSWORD :'app_pw';
ALTER ROLE taskflow_app SET statement_timeout = '10s';

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

echo "[init] đã tạo taskflow_migrator + taskflow_app cho database ${POSTGRES_DB}"
