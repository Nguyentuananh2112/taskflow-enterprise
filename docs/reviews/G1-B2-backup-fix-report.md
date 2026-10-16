# G1 B2 — Sửa theo đọc chéo backup/restore của A

**Người làm:** Engineer B · **Branch:** `fix/B2-backup-review` · **Ngày:** 2026-10-15
**Nguồn:** `docs/reviews/G1-B2-backup-crossread.md` (A, `review/G1-backup-crossread` @ `6c11b4a`)

> **Diễn tập end-to-end: XANH** (2026-10-16, người dùng duyệt chạy local, rebase trên `main` @ `d647383`) — xem "Đã kiểm".

## Đã sửa

| Finding | Sửa |
|---|---|
| **M1** — "PutObject-only ⇒ không ghi đè" sai | Runbook §1, §3: versioning + object lock (compliance, ≥ 14 ngày) **bắt buộc**, là tiêu chí chọn nhà cung cấp; lifecycle cho version noncurrent; tùy chọn bucket policy đòi `If-None-Match: *`. |
| **M2** — age bảo đảm toàn vẹn, không bảo đảm nguồn gốc | Runbook §1 sửa câu chữ. §5.1: sự cố bảo mật ⇒ chọn bản **trước** thời điểm nghi bị chiếm (đối chiếu `LastModified` / version với giờ cron); **kiểm TOC** so với DB dựng sạch bằng migration trước khi khôi phục; khôi phục bằng `taskflow_migrator`, không bao giờ superuser. §4: cảnh báo `.ok` 26 giờ chỉ là kiểm còn sống. |
| **L1** — mật khẩu DB trong argv của `pg_dump` | `backup.sh` từ chối `BACKUP_DATABASE_URL` có mật khẩu (exit 2); dùng `PGPASSWORD` / `PGPASSFILE`. Drill truyền mật khẩu theo cách đó và **kiểm** việc từ chối (exit đúng 2). |
| **L2** — tải từ stdin tối đa ~78 GiB | Biến tùy chọn `BACKUP_EXPECTED_SIZE` ⇒ `--expected-size`; ghi trong runbook §4. |
| Info — `sed` ghép `DRILL_APP_PASSWORD` | Không sửa: chỉ dữ liệu giả của drill, mật khẩu cố định `drill`. |

## Đã kiểm

- `bash -n` cả `backup.sh` và `restore-drill.sh`: OK.
- Mẫu chặn URL (`*://*:*@*`): `postgresql://u:pw@h:5432/db` ⇒ từ chối; `postgresql://u@h:5432/db?sslmode=require` và `postgresql://u@h/db` ⇒ cho qua.
- Hai biểu thức `sed` tách mật khẩu / URL của drill chạy trên `DRILL_SOURCE_URL` thật của compose ⇒ `drill` và `postgresql://taskflow_migrator@source-pg:5432/taskflow`.
- Hook pre-commit đầy đủ (prettier, gitleaks): xanh.
- Diễn tập end-to-end: `docker compose -p taskflow-drill -f docker/backup/drill.compose.yml up --build --abort-on-container-exit --exit-code-from drill` ⇒ **exit 0** (244 s gồm build image). Các bước:
  - backup.sh **từ chối** URL có mật khẩu (exit 2, drill kiểm);
  - backup qua `PGPASSWORD` ⇒ `taskflow/daily/taskflow-20261016T012807Z.dump.age` + `.ok`;
  - không có bản rõ trên storage, sai khóa ⇒ từ chối, sửa 1 byte ⇒ từ chối;
  - `pg_restore` 1 s; đối chiếu 7 bảng / 2195 dòng, index / constraint / collation / quyền / enum khớp;
  - `pg_amcheck` OK; `taskflow_app` DML được, DDL bị chặn.

  Dọn bằng `docker compose -p taskflow-drill … down` (exit 0, không `-v`). Mọi dữ liệu nằm trên tmpfs ⇒ không còn container / volume / network `taskflow-drill*`. Chỉ còn image build `taskflow-drill-drill` (bộ nhớ đệm). Compose `taskflow` dùng chung không bị đụng.

## Việc của người khác

- **Tech Lead:** có đưa "object lock bắt buộc" vào checklist go-live (`security-go-live.md` §5.5–5.6) hay không.
- **Khi chốt hosting (D3):** bucket bật versioning + object lock ngay lúc tạo (nhiều nhà cung cấp không bật được object lock cho bucket đã có).
