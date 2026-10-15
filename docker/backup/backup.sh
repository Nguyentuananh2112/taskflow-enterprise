#!/usr/bin/env bash
# Sao lưu logic Postgres → mã hóa phía client bằng age → đẩy lên storage S3 tương thích.
# Bản rõ KHÔNG BAO GIỜ chạm đĩa: pg_dump | age | aws s3 cp - (luồng trong bộ nhớ).
#
# Biến môi trường:
#   BACKUP_DATABASE_URL     postgresql://… — role chỉ cần đọc (khuyến nghị role riêng có SELECT, xem runbook)
#   BACKUP_AGE_RECIPIENTS   một hoặc nhiều public key age (age1…), cách nhau khoảng trắng.
#                           CHỈ public key — khóa giải mã không bao giờ nằm trên máy chạy backup.
#   BACKUP_S3_BUCKET        tên bucket
#   BACKUP_S3_PREFIX        tiền tố khóa (mặc định "taskflow/")
#   BACKUP_S3_ENDPOINT      endpoint S3 tương thích (bỏ trống = AWS)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION — credential CHỈ có quyền PutObject
#   BACKUP_NOW              (chỉ test) thời điểm ISO thay cho `date -u`
#
# Tầng giữ (devops.md §4.3) chọn LÚC TẢI LÊN, xóa cũ do lifecycle rule của bucket — credential
# backup không có quyền xóa (máy backup bị chiếm cũng không xóa được bản cũ):
#   ngày 1 của tháng ⇒ monthly/ (giữ 365 ngày) · Chủ nhật ⇒ weekly/ (56 ngày) · còn lại ⇒ daily/ (14 ngày)
# Dump hỏng giữa chừng: age vẫn nhận EOF và đóng luồng hợp lệ ⇒ object (dump CỤT) có thể đã lên S3
# dù script lỗi. Vì vậy chỉ khi MỌI bước thành công mới ghi thêm `<khóa>.ok` — khôi phục / giám sát
# chỉ tin bản có `.ok` (vẫn chỉ cần quyền PutObject).
# In ra MỘT dòng: khóa object đã tải lên.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?thiếu BACKUP_DATABASE_URL}"
: "${BACKUP_AGE_RECIPIENTS:?thiếu BACKUP_AGE_RECIPIENTS (public key age)}"
: "${BACKUP_S3_BUCKET:?thiếu BACKUP_S3_BUCKET}"
PREFIX="${BACKUP_S3_PREFIX:-taskflow/}"

now="${BACKUP_NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
stamp="$(date -u -d "$now" +%Y%m%dT%H%M%SZ)"
day="$(date -u -d "$now" +%d)"
weekday="$(date -u -d "$now" +%u)" # 7 = Chủ nhật
if [ "$day" = "01" ]; then tier=monthly; elif [ "$weekday" = "7" ]; then tier=weekly; else tier=daily; fi
key="${PREFIX}${tier}/taskflow-${stamp}.dump.age"

recipients=()
for r in $BACKUP_AGE_RECIPIENTS; do
  case "$r" in
    age1*) recipients+=(-r "$r") ;;
    *) echo "BACKUP FAIL: recipient không phải public key age: ${r:0:8}…" >&2; exit 2 ;;
  esac
done

s3=(aws s3)
[ -n "${BACKUP_S3_ENDPOINT:-}" ] && s3+=(--endpoint-url "$BACKUP_S3_ENDPOINT")

# Kiểm file dump đọc được TRƯỚC khi mã hóa (devops.md §4.4: "pg_restore --list sau mỗi lần dump")
# mà không cần khóa giải mã trên máy này: một nhánh của luồng đi qua `pg_restore --file=/dev/null`.
# Đọc HẾT archive (giải nén mọi khối dữ liệu) — mạnh hơn `--list` (chỉ đọc TOC rồi thoát, làm `tee`
# nhận SIGPIPE ⇒ exit 141 dưới pipefail: lỗi thật ở lần diễn tập đầu tiên).
fifo="$(mktemp -u /tmp/backup-check.XXXXXX)"
mkfifo -m 600 "$fifo"
trap 'rm -f "$fifo"' EXIT
pg_restore --file=/dev/null <"$fifo" &
check_pid=$!

pg_dump --format=custom --compress=6 --no-password "$BACKUP_DATABASE_URL" \
  | tee "$fifo" \
  | age "${recipients[@]}" \
  | "${s3[@]}" cp --only-show-errors - "s3://${BACKUP_S3_BUCKET}/${key}"

wait "$check_pid" || { echo "BACKUP FAIL: pg_restore không đọc hết được dump" >&2; exit 3; }
printf '%s\n' "$stamp" | "${s3[@]}" cp --only-show-errors - "s3://${BACKUP_S3_BUCKET}/${key}.ok"
echo "$key"
