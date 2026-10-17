#!/usr/bin/env bash
# Sao lưu KHO TỆP (Mốc 6 — ADR-141, devops.md §4.3/§4.6) → mã hóa phía client bằng age → S3 tương thích.
# Cùng thiết kế với backup.sh (runbook backup-restore.md): luồng tar | age | aws s3 cp - — bản rõ KHÔNG chạm đĩa;
# máy chỉ có PUBLIC key; tầng giữ chọn lúc tải lên; `<khóa>.ok` chỉ ghi khi MỌI bước thành công.
# Chạy SAU backup.sh (khôi phục: DB trước, tệp sau — tệp thiếu ⇒ /media 404, tệp thừa ⇒ files-sweep dọn).
#
# Biến môi trường (ngoài BACKUP_AGE_RECIPIENTS / BACKUP_S3_* / AWS_* như backup.sh):
#   BACKUP_FILES_DIR   thư mục kho, mount CHỈ ĐỌC (mặc định /var/lib/taskflow/files)
#   BACKUP_FILES_EXPECTED_SIZE (tùy chọn) ước lượng byte bản mã ⇒ `--expected-size`: tải từ stdin mặc định chia khối
#                      8 MiB ⇒ tối đa ~78 GiB; kho trần 50 GiB nên đặt khi kho > ~40 GiB.
#   BACKUP_NOW         (chỉ test) thời điểm ISO thay cho `date -u`
#
# Nhất quán: blob trong kho KHÔNG BAO GIỜ bị ghi đè (commit = hard link, khóa mới — T-067) ⇒ tar đọc tệp nào là
# đọc bản hoàn chỉnh. `tmp/` (upload đang dở) bị loại. Tệp bị xóa giữa lúc tar (sweep / xóa tin) ⇒ bỏ qua, không lỗi.
# Quyền: blob là 0600 của user `node` (uid 1000) ⇒ PHẢI chạy bằng uid 1000 (service `backup-files` trong compose).
# Tệp KHÔNG đọc được ⇒ FAIL (không `.ok`, không heartbeat) — B HIGH-1: không bao giờ ra backup rỗng mà "thành công".
# In ra MỘT dòng: khóa object đã tải lên.
set -euo pipefail

: "${BACKUP_AGE_RECIPIENTS:?thiếu BACKUP_AGE_RECIPIENTS (public key age)}"
: "${BACKUP_S3_BUCKET:?thiếu BACKUP_S3_BUCKET}"
PREFIX="${BACKUP_S3_PREFIX:-taskflow/}"
DIR="${BACKUP_FILES_DIR:-/var/lib/taskflow/files}"
[ -d "$DIR" ] || { echo "BACKUP FILES FAIL: không thấy thư mục kho $DIR" >&2; exit 2; }

now="${BACKUP_NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
stamp="$(date -u -d "$now" +%Y%m%dT%H%M%SZ)"
day="$(date -u -d "$now" +%d)"
weekday="$(date -u -d "$now" +%u)" # 7 = Chủ nhật
if [ "$day" = "01" ]; then tier=monthly; elif [ "$weekday" = "7" ]; then tier=weekly; else tier=daily; fi
key="${PREFIX}${tier}/taskflow-files-${stamp}.tar.age"

recipients=()
for r in $BACKUP_AGE_RECIPIENTS; do
  case "$r" in
    age1*) recipients+=(-r "$r") ;;
    *) echo "BACKUP FILES FAIL: recipient không phải public key age: ${r:0:8}…" >&2; exit 2 ;;
  esac
done

s3=(aws s3)
[ -n "${BACKUP_S3_ENDPOINT:-}" ] && s3+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
size=()
[ -n "${BACKUP_FILES_EXPECTED_SIZE:-}" ] && size=(--expected-size "$BACKUP_FILES_EXPECTED_SIZE")

# Kiểm TRƯỚC: có tệp không đọc được (sai uid / quyền) ⇒ FAIL ngay, chỉ in số lượng (không in tên).
unreadable="$(find "$DIR" -path "$DIR/tmp" -prune -o -type f ! -readable -print | wc -l)"
if [ "$unreadable" -gt 0 ]; then
  echo "BACKUP FILES FAIL: $unreadable tệp không đọc được — chạy bằng uid 1000 (user node)?" >&2
  exit 4
fi
expected="$(find "$DIR" -path "$DIR/tmp" -prune -o -type f -print | wc -l)"

# GNU tar: exit 1 = "có tệp đổi / biến mất khi đang đọc" — chấp nhận (blob không bị ghi đè; tệp mất = đã xóa
# hợp lệ); exit ≥ 2 (gồm tệp KHÔNG đọc được — không dùng --ignore-failed-read) = lỗi thật.
archive() {
  local rc=0
  tar --create --file=- --directory="$DIR" --exclude=./tmp --numeric-owner \
    --warning=no-file-changed --warning=no-file-removed . || rc=$?
  [ "$rc" -le 1 ] || { echo "BACKUP FILES FAIL: tar exit $rc" >&2; return "$rc"; }
}

# Đếm tệp THỰC SỰ vào archive trên một nhánh của luồng (bản rõ không chạm đĩa): kho có tệp mà archive không có tệp
# nào ⇒ FAIL (lưới cuối cho HIGH-1).
fifo="$(mktemp -u /tmp/backup-files-count.XXXXXX)"
counted="$(mktemp /tmp/backup-files-n.XXXXXX)"
mkfifo -m 600 "$fifo"
trap 'rm -f "$fifo" "$counted"' EXIT
{ tar --list --file=- <"$fifo" | grep -vc '/$' >"$counted" || true; } &
count_pid=$!

archive | tee "$fifo" | age "${recipients[@]}" \
  | "${s3[@]}" cp --only-show-errors "${size[@]}" - "s3://${BACKUP_S3_BUCKET}/${key}"
wait "$count_pid"
archived="$(cat "$counted")"
if [ "$expected" -gt 0 ] && [ "${archived:-0}" -eq 0 ]; then
  echo "BACKUP FILES FAIL: kho có $expected tệp nhưng archive không có tệp nào" >&2
  exit 5
fi
printf '%s\n' "$stamp" | "${s3[@]}" cp --only-show-errors - "s3://${BACKUP_S3_BUCKET}/${key}.ok"
echo "$key"
