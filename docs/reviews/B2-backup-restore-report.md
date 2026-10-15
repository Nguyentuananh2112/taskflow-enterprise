# B2 Report — Sao lưu mã hóa + diễn tập khôi phục tự động

**Người làm:** Engineer B · **Branch:** `feat/B2-backup-restore` · **Ngày:** 2026-10-15
**Nguồn:** `docs/tasks/BACKLOG.md` B2 · ADR-072, ADR-074 · `devops.md` §4.3–4.4

## Đã làm

| File | Nội dung |
|---|---|
| `docker/backup/Dockerfile` | `postgres:18.6-bookworm` + `age` + aws CLI, chạy bằng user `postgres`. Client `pg_dump` cùng major với server. |
| `docker/backup/backup.sh` | `pg_dump -Fc \| tee(nhánh kiểm) \| age -r <public key…> \| aws s3 cp -`: bản rõ không chạm đĩa. Nhánh kiểm `pg_restore --file=/dev/null` đọc **hết** archive trước khi mã hóa (không cần khóa giải mã trên máy backup). Tầng `daily/` / `weekly/` / `monthly/` chọn lúc tải lên. Dấu hoàn tất `<khóa>.ok` chỉ ghi khi mọi bước thành công. Credential chỉ cần **PutObject**. |
| `docker/backup/restore-drill.sh` | Diễn tập đầy đủ — xem bên dưới. |
| `docker/backup/fixture.sql` | Dữ liệu **giả** đa dạng: tiếng Việt, JSONB, inet, NULL, xóa mềm, enum, partial unique (rank trùng giữa task xóa / sống), FK kép. |
| `docker/backup/drill.compose.yml` | Tự chứa: Postgres nguồn + Postgres tạm (dùng `docker/postgres/init` để có role thật), MinIO, drill. Không mở cổng ra host; tmpfs. |
| `.github/workflows/backup-drill.yml` | Hằng tuần (thứ Hai 03:00 UTC), chạy tay, và trên PR đụng `docker/backup`, role init, `grant-app.sql`, migration. Không dùng secret. |
| `docs/runbook/backup-restore.md` | Lý do chọn age, khóa offline (2 người nhận), bucket (versioning / object lock, lifecycle theo tầng), credential tối thiểu, lịch + cảnh báo `.ok` 26 giờ, quy trình khôi phục, lịch diễn tập. |

### Diễn tập kiểm gì

1. Backup thật bằng đúng `backup.sh` lên S3 (MinIO); có dấu `.ok`.
2. **Mã hóa:**
   - object trên storage không chứa dump bản rõ (`PGDMP`);
   - khóa khác ⇒ giải mã bị từ chối;
   - sửa 1 byte giữa bản mã ⇒ giải mã bị từ chối (age có xác thực).
3. Khôi phục theo luồng `storage → age -d → pg_restore --single-transaction` vào DB tạm mới, rồi chạy `grant-app.sql` như runbook production.
4. **Đối chiếu nguồn ↔ bản khôi phục** (`diff` hai "ảnh chụp"):
   - mỗi bảng: số dòng + md5 toàn bộ dữ liệu;
   - định nghĩa index (gồm partial unique);
   - constraint (gồm CHECK, FK kép);
   - kiểu + collation từng cột;
   - quyền `taskflow_app` / `taskflow_migrator` trên bảng;
   - enum, default privileges, encoding / collate của DB.
5. `pg_amcheck --heapallindexed` trên bản khôi phục.
6. Quyền thực tế: `taskflow_app` DML được, DDL bị chặn.

## Kết quả

```text
$ docker compose -f docker/backup/drill.compose.yml up --build --abort-on-container-exit --exit-code-from drill
[drill] đã tải lên: taskflow/daily/taskflow-20261015T144200Z.dump.age
[drill] mã hóa: không có bản rõ trên storage; sai khóa ⇒ từ chối; sửa 1 byte ⇒ từ chối
[drill] pg_restore xong sau 1s → drill_restore_20261015144203
[drill] đối chiếu: 7 bảng, 2195 dòng; index / constraint / collation / quyền / enum khớp
[drill] pg_amcheck: OK
[drill] quyền: taskflow_app DML được, DDL bị chặn
[drill] THÀNH CÔNG — …                                   → exit 0
```

**Kiểm đột biến (chống xanh giả):** sửa tiêu đề MỘT task ở nguồn **sau** khi backup ⇒ đối chiếu đỏ.
- `tasks` vẫn 1000 dòng nhưng md5 khác ⇒ `diff` chỉ đúng `table|tasks`, exit ≠ 0.
- Như vậy phép so sánh bắt được thay đổi nội dung, không chỉ số dòng.
- Script đột biến chạy trên bản sao trong container; file thật không đổi.

## Lỗi tìm được nhờ chạy thật (đã sửa)

1. **Exit 141 (SIGPIPE):** `pg_restore --list` chỉ đọc TOC rồi thoát ⇒ `tee` ghi vào fifo đã đóng ⇒ `pipefail` làm backup lỗi. Sửa: nhánh kiểm đọc **hết** archive (`pg_restore --file=/dev/null`). Kiểm tra này cũng mạnh hơn `--list` mà `devops.md` §4.4 yêu cầu.
2. Ghép chuỗi với cột kiểu `"char"` (`defaclobjtype`) ⇒ ép `::text`.
3. `pg_amcheck -d` là **mẫu tên database**, không phải conninfo ⇒ truyền chuỗi kết nối làm tham số vị trí.

## Quyết định tự đưa ra

- **age, không phải gpg** — lý do ở runbook §1 (mã hóa có xác thực, khóa đơn giản, nhiều người nhận, không keyring).
- **Retention bằng lifecycle rule của bucket**, script không xóa ⇒ credential backup không có quyền xóa (chống ransomware / máy backup bị chiếm). Mỗi bản chỉ thuộc một tầng (chọn lúc tải lên) ⇒ không cần quyền copy / đọc.
- **Dấu `.ok`** thay vì đổi tên object (đổi tên cần copy + delete = thêm quyền).
- **Đối chiếu tổng quát theo catalog** thay vì danh sách bảng cứng ⇒ schema đổi không phải sửa drill. Fixture vẫn phải theo schema: migration thêm cột NOT NULL không default ⇒ workflow chạy trên PR đụng migration sẽ đỏ — đó là tín hiệu đúng.
- **Diễn tập dùng khóa age TẠM** (dữ liệu giả). Khóa production chỉ được thử theo lịch thủ công hằng quý (runbook §5.2), không bao giờ vào CI.

## Việc liên quan người khác

- **D (CI):**
  - workflow mới `.github/workflows/backup-drill.yml` (pin `actions/checkout` theo SHA như `mutation.yml`), kéo `quay.io/minio/minio:RELEASE.2024-09-13T20-26-02Z` và `postgres:18.6-bookworm`;
  - nhờ D rà theo quy ước CI.
- **Khi chốt hosting (D3):**
  - lên lịch job `backup.sh` hằng ngày;
  - tạo bucket + lifecycle + credential PutObject-only;
  - tạo role `taskflow_backup` (SELECT-only);
  - cảnh báo khi không có `.ok` mới trong 26 giờ.

## DoD

- Diễn tập end-to-end: exit 0. Kiểm đột biến: đỏ đúng chỗ.
- `pnpm lint` (prettier phủ YAML / Markdown + eslint + depcruise): exit 0.
- Không có thay đổi TypeScript ⇒ không chạy typecheck / test.
