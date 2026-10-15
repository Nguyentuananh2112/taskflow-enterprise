# Runbook — Sao lưu mã hóa và khôi phục Postgres

**Chủ tài liệu:** Engineer B · **Liên quan:** ADR-072 (repo public), ADR-074, `devops.md` §4.3–4.4, `security-go-live.md` §5.5–5.6.
**Phạm vi:** bản sao lưu **logic** độc lập với nhà cung cấp hosting (`pg_dump`). PITR của nền tảng là lớp riêng (RPO ≤ 5 phút); bản logic này là lớp cuối khi mất cả tài khoản hosting (RPO ≤ 24h, RTO ≤ 2h).

Công cụ: image `docker/backup/Dockerfile` (Postgres 18.6 + `age` + aws CLI). Client `pg_dump` / `pg_restore` cùng major với server.

---

## 1. Thiết kế (tóm tắt lý do)

| Quyết định | Lý do |
|---|---|
| **age** (không phải gpg) | Mã hóa có xác thực (ChaCha20-Poly1305): bản mã bị sửa / cắt ⇒ giải mã **thất bại**, không ra dữ liệu rác. Khóa X25519 ngắn, không keyring / trust model / cấu hình — ít chỗ cấu hình sai. Mã hóa theo luồng nên không cần file tạm. Hỗ trợ **nhiều người nhận** (nhiều public key) ⇒ có khóa dự phòng mà không chia sẻ khóa bí mật. |
| Máy chạy backup **chỉ có public key** | Máy backup bị chiếm vẫn **không** đọc được backup nào. Khóa giải mã cất offline (mục 2). |
| Luồng `pg_dump \| age \| aws s3 cp -` | Dump bản rõ **không bao giờ** nằm trên đĩa. |
| Nhánh kiểm `pg_restore --file=/dev/null` trên luồng **trước** khi mã hóa | Bắt dump hỏng ngay lúc sao lưu mà không cần khóa giải mã trên máy backup. |
| Dấu hoàn tất `<khóa>.ok` | Nếu `pg_dump` chết giữa chừng, age vẫn đóng luồng hợp lệ ⇒ object (dump cụt) có thể đã lên S3. Chỉ tin bản có `.ok`. |
| Tầng giữ chọn **lúc tải lên** (`daily/`, `weekly/`, `monthly/`), xóa cũ bằng **lifecycle rule** | Credential backup chỉ cần **PutObject** — không có quyền xóa / ghi đè. Kẻ chiếm máy backup không xóa được bản cũ (chống ransomware). |
| Storage **khác nhà cung cấp hosting**, giao diện S3 tương thích | Mất tài khoản hosting không mất backup. Chạy được với R2, B2, Wasabi, S3, MinIO. |

## 2. Khóa giải mã (làm MỘT lần, trước go-live)

1. Trên máy **offline** hoặc máy tin cậy của chủ dự án: `age-keygen -o taskflow-backup.key` (in ra public key `age1…`).
2. Tạo **khóa dự phòng thứ hai** do người thứ hai giữ (Tech Lead): `age-keygen -o taskflow-backup-2.key`.
3. Cất khóa bí mật ở **≥ 2 nơi tách biệt** (password manager của chủ dự án + bản in / USB mã hóa trong két). Không bao giờ để khóa bí mật trên server, trong GitHub secrets, trong repo hay gửi cho agent.
4. `BACKUP_AGE_RECIPIENTS` = cả hai public key, cách nhau bằng dấu cách. Giải mã được bằng **bất kỳ** khóa nào.
5. Mất cả hai khóa bí mật = mất mọi backup ⇒ kiểm tra hằng quý rằng khóa còn mở được (mục 5.2).

## 3. Storage

- Bucket riêng, **versioning + object lock** (chế độ governance hoặc compliance, tối thiểu 14 ngày) nếu nhà cung cấp hỗ trợ.
- Lifecycle rule (thời gian giữ theo `devops.md` §4.3):

| Tiền tố | Hết hạn |
|---|---|
| `taskflow/daily/` | 14 ngày |
| `taskflow/weekly/` | 56 ngày |
| `taskflow/monthly/` | 365 ngày |

- Credential của job backup: **chỉ** `PutObject` trên `taskflow/*`. Credential khôi phục (đọc) là một bộ khác, chỉ chủ dự án / Tech Lead có, chỉ dùng khi khôi phục.
- Role Postgres cho backup: nên dùng role riêng chỉ có `SELECT` trên mọi bảng + `USAGE` trên schema (`pg_dump` không cần quyền ghi). Không dùng `taskflow_app` (có quyền ghi) và không dùng superuser.

## 4. Lịch sao lưu (production)

Chạy image `docker/backup` hằng ngày (cron của nền tảng hoặc scheduled job), lệnh `backup.sh`, với env:

| Biến | Ví dụ |
|---|---|
| `BACKUP_DATABASE_URL` | `postgresql://taskflow_backup:…@db:5432/taskflow?sslmode=require` |
| `BACKUP_AGE_RECIPIENTS` | `age1… age1…` |
| `BACKUP_S3_BUCKET` | `taskflow-backups` |
| `BACKUP_S3_ENDPOINT` | endpoint S3 tương thích (bỏ trống nếu AWS) |
| `BACKUP_S3_PREFIX` | `taskflow/` (mặc định) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION` | credential **PutObject-only** |

Exit ≠ 0 ⇒ cảnh báo. **Cảnh báo độc lập:** không có object `*.ok` mới trong 26 giờ ⇒ email (`devops.md` §6.5). Job "xanh" nhưng không chạy cũng bị bắt.

## 5. Khôi phục

### 5.1 Khôi phục thật (sự cố)

1. Chọn bản **mới nhất có `.ok`** (hoặc theo thời điểm cần): `aws s3 ls s3://<bucket>/taskflow/ --recursive | grep '\.ok$'`.
2. Postgres 18 đích đã có role `taskflow_migrator` / `taskflow_app` (script `docker/postgres/init/01-roles.sh` hoặc tương đương managed). Tạo DB mới, owner `taskflow_migrator`.
3. Trên máy tin cậy có khóa bí mật — luồng, không ghi file bản rõ:
   ```sh
   aws s3 cp s3://<bucket>/<khóa>.dump.age - \
     | age -d -i taskflow-backup.key \
     | pg_restore --exit-on-error --single-transaction --no-password -d "postgresql://taskflow_migrator:…@<host>/<db-mới>"
   psql "postgresql://taskflow_migrator:…@<host>/<db-mới>" -f docker/migrate/grant-app.sql
   ```
   `grant-app.sql` bắt buộc: quyền cấp **database** (`CONNECT` cho `taskflow_app`) không nằm trong `pg_dump`.
4. Kiểm tra trước khi trỏ app vào:
   - `pnpm --filter @taskflow/api exec prisma migrate status` ⇒ up to date;
   - số dòng các bảng chính hợp lý so với trước sự cố;
   - `pg_amcheck --heapallindexed` (superuser) ⇒ OK;
   - đăng nhập user canary, đọc board.
5. Trỏ `DATABASE_URL` của app sang DB mới, deploy. **Thu hồi mọi phiên** nếu sự cố có thể liên quan lộ dữ liệu (`security-go-live.md` §9.2).
6. Ghi lại vào `docs/ops/restore-drills.md` (thời gian từng bước ⇒ đo RTO thật).

### 5.2 Diễn tập

| Loại | Khi nào | Cách |
|---|---|---|
| **Tự động** | Hằng tuần (thứ Hai 03:00 UTC) + mỗi PR đụng `docker/backup`, migration, role | Workflow `.github/workflows/backup-drill.yml` → `docker/backup/drill.compose.yml`: schema thật + dữ liệu giả → `backup.sh` thật → MinIO → kiểm: không có bản rõ trên storage, sai khóa bị từ chối, sửa 1 byte bị từ chối → khôi phục vào DB tạm → **đối chiếu** với nguồn (số dòng + md5 dữ liệu từng bảng, index kể cả partial unique, constraint, kiểu + collation từng cột, quyền, enum, default privileges, encoding) → `pg_amcheck` → `taskflow_app` DML được / DDL bị chặn |
| **Thủ công trên backup thật** | Hằng tháng + trước go-live | Mục 5.1 vào DB tạm (không trỏ app); đo thời gian; xóa DB tạm sau khi ghi kết quả |
| **Kiểm khóa** | Hằng quý | Giải mã một bản `monthly/` bằng **từng** khóa bí mật (chỉ `age -d … \| pg_restore --list`) |

Chạy diễn tập tự động ở máy local:

```sh
docker compose -f docker/backup/drill.compose.yml up --build --abort-on-container-exit --exit-code-from drill
docker compose -f docker/backup/drill.compose.yml down -v
```

## 6. Những gì KHÔNG làm

- Không lưu dump / backup / khóa trong repo hay artifact CI (repo public — ADR-072; `.gitignore` + gitleaks đã chặn).
- Không cho job backup quyền xóa hay đọc bucket.
- Không giải mã trên server production; không ghi file dump bản rõ ra đĩa.
- Không backup Valkey (dữ liệu dựng lại được).
