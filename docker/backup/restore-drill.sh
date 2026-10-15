#!/usr/bin/env bash
# Diễn tập khôi phục TỰ ĐỘNG (B2, devops.md §4.4): backup thật → tải về → giải mã → pg_restore vào
# DB tạm → ĐỐI CHIẾU với nguồn. "Backup chưa từng restore thì coi như chưa có backup."
# Chạy bởi docker/backup/drill.compose.yml (local + CI hằng tuần). Toàn bộ là dữ liệu GIẢ.
#
# Biến môi trường:
#   DRILL_SOURCE_URL            URL migrator tới DB nguồn (đã có role taskflow_app / taskflow_migrator)
#   DRILL_SCRATCH_URL           URL migrator (CREATEDB) tới DB `postgres` của Postgres tạm
#   DRILL_SCRATCH_SUPERUSER_URL URL superuser Postgres tạm — CHỈ để chạy pg_amcheck (cần extension)
#   DRILL_APP_PASSWORD          mật khẩu taskflow_app trên Postgres tạm (kiểm quyền thực tế)
#   DRILL_PREPARE_SOURCE=1      áp /migrations/*/migration.sql + /grant-app.sql + /fixture.sql vào nguồn
#   BACKUP_S3_BUCKET / BACKUP_S3_ENDPOINT / AWS_*  như backup.sh
#   DRILL_AGE_IDENTITY_FILE     khóa giải mã age; bỏ trống ⇒ sinh cặp khóa TẠM cho lần diễn tập
set -euo pipefail

: "${DRILL_SOURCE_URL:?}" "${DRILL_SCRATCH_URL:?}" "${DRILL_SCRATCH_SUPERUSER_URL:?}"
: "${DRILL_APP_PASSWORD:?}" "${BACKUP_S3_BUCKET:?}"
s3=(aws s3)
[ -n "${BACKUP_S3_ENDPOINT:-}" ] && s3+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
log() { printf '[drill] %s\n' "$*"; }
fail() {
  printf '[drill] FAIL: %s\n' "$*" >&2
  exit 1
}
psql_q() { psql -X -v ON_ERROR_STOP=1 -q "$@"; }

# 0. Chờ storage sẵn sàng (MinIO khởi động sau Postgres).
for _ in $(seq 1 30); do
  "${s3[@]}" ls >/dev/null 2>&1 && break
  sleep 2
done
"${s3[@]}" mb "s3://${BACKUP_S3_BUCKET}" >/dev/null 2>&1 || true

# 1. Nguồn: schema thật (migration Prisma là SQL thuần) + quyền app + dữ liệu giả.
if [ "${DRILL_PREPARE_SOURCE:-0}" = "1" ]; then
  log "chuẩn bị nguồn: migrations + grant-app + fixture"
  while IFS= read -r f; do psql_q "$DRILL_SOURCE_URL" -f "$f"; done < <(ls -1 /migrations/*/migration.sql | sort)
  psql_q "$DRILL_SOURCE_URL" -f /grant-app.sql
  psql_q "$DRILL_SOURCE_URL" -f /fixture.sql
fi

# 2. Khóa: lần diễn tập dùng cặp khóa TẠM (dữ liệu giả); production dùng khóa offline thật.
identity="${DRILL_AGE_IDENTITY_FILE:-}"
if [ -z "$identity" ]; then
  identity="$(mktemp /tmp/drill-age.XXXXXX)"
  rm -f "$identity"
  age-keygen -o "$identity" 2>/dev/null
fi
recipient="$(age-keygen -y "$identity")"

# 3. Backup thật bằng đúng script production.
log "backup.sh"
key="$(BACKUP_DATABASE_URL="$DRILL_SOURCE_URL" BACKUP_AGE_RECIPIENTS="$recipient" backup.sh)"
log "đã tải lên: $key"
"${s3[@]}" ls "s3://${BACKUP_S3_BUCKET}/${key}.ok" >/dev/null || fail "thiếu dấu hoàn tất ${key}.ok"

# 4. Trên storage chỉ có bản mã; sai khóa ⇒ từ chối; sửa 1 byte ⇒ từ chối (age có xác thực).
enc="$(mktemp /tmp/drill-enc.XXXXXX)"
"${s3[@]}" cp --only-show-errors "s3://${BACKUP_S3_BUCKET}/${key}" "$enc"
if head -c 64 "$enc" | grep -aq "PGDMP"; then fail "object trên storage chứa dump bản rõ"; fi
other="$(mktemp /tmp/drill-other.XXXXXX)"
rm -f "$other"
age-keygen -o "$other" 2>/dev/null
if age -d -i "$other" "$enc" >/dev/null 2>&1; then fail "giải mã được bằng khóa KHÁC"; fi
size="$(stat -c %s "$enc")"
printf 'X' | dd of="$enc" bs=1 seek=$((size / 2)) conv=notrunc status=none
if age -d -i "$identity" "$enc" >/dev/null 2>&1; then fail "bản mã bị sửa vẫn giải mã được"; fi
rm -f "$enc" "$other"
log "mã hóa: không có bản rõ trên storage; sai khóa ⇒ từ chối; sửa 1 byte ⇒ từ chối"

# 5. Khôi phục vào DB tạm MỚI (luồng: storage → age → pg_restore, không file bản rõ), rồi chạy lại
#    grant-app.sql như runbook production (quyền cấp database không nằm trong pg_dump).
db="drill_restore_$(date -u +%Y%m%d%H%M%S)"
restored="${DRILL_SCRATCH_URL%/*}/${db}"
psql_q "$DRILL_SCRATCH_URL" -c "CREATE DATABASE \"${db}\""
start=$(date +%s)
"${s3[@]}" cp --only-show-errors "s3://${BACKUP_S3_BUCKET}/${key}" - |
  age -d -i "$identity" |
  pg_restore --exit-on-error --single-transaction --no-password -d "$restored"
psql_q "$restored" -f /grant-app.sql
log "pg_restore xong sau $(($(date +%s) - start))s → ${db}"

# 6. Đối chiếu nguồn ↔ bản khôi phục: dữ liệu (số dòng + md5 từng bảng), index (kể cả partial
#    unique), constraint, kiểu + collation từng cột, quyền trên bảng, enum, default privileges, encoding.
snapshot() {
  psql -X -v ON_ERROR_STOP=1 -q -A -t "$1" -f /dev/stdin <<'SQL'
SELECT 'db|' || pg_encoding_to_char(encoding) || '|' || datcollate || '|' || datctype
  FROM pg_database WHERE datname = current_database();
SELECT 'table|' || c.relname
  || '|' || (xpath('/row/n/text()',
       query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
  || '|' || (xpath('/row/m/text()',
       query_to_xml(format('SELECT md5(coalesce(string_agg(t::text, chr(10) ORDER BY t::text), %L)) AS m FROM public.%I t',
                           '', c.relname), false, true, '')))[1]::text
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' ORDER BY 1;
SELECT 'index|' || indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1;
SELECT 'constraint|' || conrelid::regclass || '|' || conname || '|' || pg_get_constraintdef(oid)
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1;
SELECT 'column|' || table_name || '.' || column_name || '|' || data_type || '|' || coalesce(collation_name, '-')
  FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1;
SELECT 'grant|' || grantee || '|' || table_name || '|' || privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee IN ('taskflow_app', 'taskflow_migrator') ORDER BY 1;
SELECT 'enum|' || t.typname || '|' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
  FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname ORDER BY 1;
SELECT 'defacl|' || pg_get_userbyid(defaclrole) || '|' || defaclobjtype || '|' || defaclacl::text
  FROM pg_default_acl ORDER BY 1;
SQL
}
src_snap="$(mktemp)"
dst_snap="$(mktemp)"
snapshot "$DRILL_SOURCE_URL" >"$src_snap"
snapshot "$restored" >"$dst_snap"
tables="$(grep -c '^table|' "$src_snap")"
rows="$(awk -F'|' '/^table\|/ { s += $3 } END { print s + 0 }' "$src_snap")"
if [ "$tables" -eq 0 ] || [ "$rows" -eq 0 ]; then fail "nguồn rỗng — phép so sánh vô nghĩa"; fi
if ! diff -u "$src_snap" "$dst_snap"; then fail "bản khôi phục KHÁC nguồn (xem diff ở trên)"; fi
log "đối chiếu: ${tables} bảng, ${rows} dòng; index / constraint / collation / quyền / enum khớp"

# 7. Toàn vẹn vật lý: heap + mọi btree index của bản khôi phục.
pg_amcheck --install-missing --heapallindexed --no-password -d "${DRILL_SCRATCH_SUPERUSER_URL%/*}/${db}" ||
  fail "pg_amcheck phát hiện hỏng"
log "pg_amcheck: OK"

# 8. Quyền thực tế: taskflow_app đọc/ghi được, KHÔNG có DDL (tách quyền còn nguyên sau khôi phục).
app_url="$(printf '%s' "$restored" | sed -E "s#//taskflow_migrator:[^@]*@#//taskflow_app:${DRILL_APP_PASSWORD}@#")"
psql_q "$app_url" -c "BEGIN; SELECT count(*) FROM tasks; UPDATE tasks SET version = version WHERE false; ROLLBACK;" \
  >/dev/null || fail "taskflow_app không đọc/ghi được bản khôi phục"
if psql -X -q "$app_url" -c "CREATE TABLE drill_should_fail (x int)" >/dev/null 2>&1; then
  fail "taskflow_app tạo được bảng — tách quyền mất sau khôi phục"
fi
log "quyền: taskflow_app DML được, DDL bị chặn"

psql_q "$DRILL_SCRATCH_URL" -c "DROP DATABASE \"${db}\" WITH (FORCE)"
log "THÀNH CÔNG — backup ${key} khôi phục được và khớp nguồn"
