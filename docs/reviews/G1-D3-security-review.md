# G1 — Đọc chéo bảo mật D3 (chuẩn bị deploy)

**Người đọc:** Engineer B · **Chủ code:** Engineer D · **Branch được đọc:** `feat/D3-deploy-prep` @ `899cd2f` (WIP, chỉ đọc) · **Ngày:** 2026-10-15
**Phạm vi:** `.github/workflows/{release,deploy}.yml`, `.do/app.yaml`, `deploy/vps/*`, `docs/runbook/deploy.md`, `docker/migrate/migrate.mjs`. Trọng tâm: repo **public** (ADR-072).
**Kết luận:** 1 High, 3 Medium, 5 Low. Không chặn việc tiếp tục D3; **High phải sửa trước khi bật `ENABLE_RELEASE`**.

## High

### H1 — `release.yml`: PR từ fork có nhánh tên `main` kích hoạt release ⇒ image do người ngoài build được đẩy lên GHCR chính thức

| | |
|---|---|
| Vị trí | `release.yml` — `on.workflow_run.branches: [main]` + `if: … conclusion == 'success'`; checkout `ref: workflow_run.head_sha` |
| Cơ chế | Bộ lọc `branches` của `workflow_run` so với **tên** nhánh head của lần chạy CI, không phân biệt repo. CI chạy trên `pull_request` (kể cả fork). PR từ fork có nhánh tên `main` ⇒ CI xanh ⇒ Release chạy **trong ngữ cảnh repo gốc** với `packages: write`, checkout **commit của fork** và build `Dockerfile` của fork. |
| Hậu quả | Image chứa mã của người ngoài được đẩy lên `ghcr.io/<owner>/taskflow-{api,web,migrate,backup}:sha-<sha của fork>`, kèm job summary "Release sha-…" và hướng dẫn deploy. Người deploy chỉ chọn `git_sha` ⇒ một SHA lẫn lộn là deploy mã lạ lên production. Registry chính thức không còn đồng nghĩa với "đã qua review". |
| Điều kiện | Cần `ENABLE_RELEASE=true` (sẽ bật lúc go-live). Người đóng góp lần đầu cần duyệt chạy CI, người đã có PR merge thì không. |
| Sửa | Thêm vào `if` của job: `github.event.workflow_run.event == 'push'` **và** `github.event.workflow_run.head_repository.full_name == github.repository` **và** `github.event.workflow_run.head_branch == 'main'`. Giữ `workflow_dispatch`, nhưng chỉ cho ref `main`: `github.ref == 'refs/heads/main'`. Test: actionlint + đọc lại; ghi vào `security-go-live.md` (kiểm trước khi bật `ENABLE_RELEASE`). |

## Medium

### M1 — Khóa SSH deploy = quyền root trên VPS

- **Vị trí:** runbook `deploy.md` §B.1. User `deploy` nằm trong nhóm `docker` (tương đương root). Khóa riêng nằm trong secret `VPS_SSH_KEY` của GitHub.
- **Hậu quả:** khóa lộ (workflow bị chèn, runner bị chiếm, người có quyền sửa environment) ⇒ chạy lệnh bất kỳ với quyền root: đọc `.env` (mật khẩu DB, `JWT_ACCESS_SECRET`), dump DB.
- **Sửa:**
  - `authorized_keys` của `deploy`: `restrict,command="/opt/taskflow/ci-entry.sh" ssh-ed25519 …`;
  - `ci-entry.sh` đọc `SSH_ORIGINAL_COMMAND` và chỉ nhận đúng 2 dạng: nhận gói file (tar qua stdin vào thư mục staging, kiểm danh sách tên), hoặc `deploy <sha40> <digest>×3–4` (kiểm regex rồi gọi `deploy.sh`);
  - thay `scp` trong `deploy.yml` bằng `tar … | ssh … receive`.

  Khi đó khóa lộ chỉ deploy được image đã có trên GHCR — kết hợp H1 là đủ chặn.

### M2 — Production: thứ tự "staging trước" và nhánh `main` chỉ nằm trong runbook

- **Vị trí:** `deploy.yml` — input `git_sha` ghi "production phải là commit đã deploy staging xanh", nhưng không có bước nào kiểm.
- **Hậu quả:** an toàn phụ thuộc hoàn toàn vào cấu hình tay của environment (`Deployment branches = main` + required reviewers). Thiếu `Deployment branches`, `workflow_dispatch` từ một nhánh bất kỳ dùng **file workflow của nhánh đó** cùng secret production.
- **Sửa:**
  - bước đầu của job, khi `environment == production`:
    - `github.ref == 'refs/heads/main'`, sai ⇒ dừng;
    - gọi API deployments (`gh api repos/{repo}/deployments?environment=staging&sha=$GIT_SHA`), kiểm có status `success`, không có ⇒ dừng.
  - `security-go-live.md`: kiểm cấu hình 2 environment (ảnh chụp màn hình Settings) **trước** lần deploy production đầu tiên.
  - Secret chỉ đặt ở **environment**, không ở repo (runbook đã ghi — thêm câu "không bao giờ repo-level").

### M3 — Backup trên D3 sẽ hỏng sau khi merge fix B2, và file mẫu env không vào được repo

1. `fix/B2-backup-review` (B, chờ diễn tập) cho `backup.sh` **từ chối** `BACKUP_DATABASE_URL` có mật khẩu (mật khẩu nằm trong argv của `pg_dump`).
   - `app.yaml` job `backup` và `.env.backup` của VPS đang dự kiến URL có mật khẩu.
   - Sửa: URL không mật khẩu + biến `PGPASSWORD` (`type: SECRET` trên App Platform; một dòng trong `.env.backup.example`).
2. `deploy/vps/.env.api.example` và `.env.backup.example` **không có trong branch**: `.gitignore` chặn `.env.*`, chỉ trừ `.env.example`.
   - Hậu quả: `deploy.yml` `scp` hai file này ⇒ deploy VPS lỗi; `bootstrap.sh` không sinh được `.env.api`.
   - Lỗi theo hướng an toàn (dừng), nhưng chặn D3.
   - Sửa: thêm `!*.env.*.example` (hoặc tên cụ thể) vào `.gitignore`, rồi `git check-ignore -v` để chắc. gitleaks vẫn quét nội dung.

## Low

| ID | Vấn đề | Sửa |
|---|---|---|
| L1 | `deploy.sh` không kiểm `git_sha` (chỉ kiểm digest) mà ghi thẳng vào `.env` bằng `sed` — chạy tay trên máy là đường không qua workflow | `[[ "$1" =~ ^[0-9a-f]{40}$ ]]` như digest |
| L2 | Token DigitalOcean dài hạn (DO không có OIDC cho GitHub Actions) | Custom-scoped token chỉ `app:read` + `app:update`, **có hạn** (≤ 90 ngày), lịch xoay ghi trong go-live §9; environment secret của `production` / `staging` tách riêng |
| L3 | Smoke kiểm HSTS chỉ ở API; web cũng phải có (`csp.ts` đã đặt) | Thêm `curl -fsSI "$APP_BASE_URL/" \| grep -qi '^strict-transport-security:'` |
| L4 | App Platform: chưa giới hạn nguồn kết nối vào Managed PG / Valkey | Bật **trusted sources** = chỉ app `taskflow` (runbook §A); URL app dùng `sslmode=require` (DO bắt buộc TLS) |
| L5 | Comment `bootstrap.sh`: "/opt/taskflow (700, chỉ root)" — runbook tạo thư mục owner `deploy`. `valkey.key` 644 dựa vào quyền thư mục cha | Sửa comment cho khớp runbook; giữ `/opt/taskflow` 700 |

## Info

- **Docker vượt qua `ufw`:** cổng `ports:` của compose được Docker mở bằng iptables riêng, bỏ qua `ufw`. Hiện chỉ Caddy mở 80/443 nên đúng; ghi vào runbook "không thêm `ports:` cho postgres / valkey / api" để không ai vô tình mở.
- **Caddy `encode` trên API:** nén response có token (BREACH) chỉ nguy hiểm khi cùng response phản chiếu input của kẻ tấn công. Response auth không phản chiếu ⇒ chấp nhận.

## Đạt

- **`release.yml`, `deploy.yml`:**
  - `permissions: contents: read` ở cấp workflow; `packages: write` chỉ ở job release;
  - không `pull_request_target`;
  - mọi action pin theo SHA (có comment version);
  - `persist-credentials: false`;
  - login GHCR bằng `GITHUB_TOKEN`, không secret dài hạn.
- **Release / deploy theo digest:**
  - deploy theo **digest**, không build lại;
  - `provenance` + `sbom`;
  - artifact `release.json` chỉ có digest.
- **SSH và input:**
  - SSH ghim host key qua `VPS_KNOWN_HOSTS` (không `StrictHostKeyChecking=no`);
  - `git_sha` được kiểm 40 hex trước khi vào lệnh SSH;
  - digest được kiểm `sha256:[0-9a-f]{64}` trong `deploy.sh`.
- **Spec App Platform:**
  - lấy spec đang chạy rồi chỉ thay digest bằng `yq` ⇒ secret `EV[…]` không bao giờ rời DO;
  - `diff` ra log chỉ có digest / `GIT_SHA`.
- **`migrate.mjs`:**
  - `spawnSync` không qua shell, không in `DATABASE_URL` (lỗi Prisma P1000 chỉ nêu host / user);
  - URL migrator chỉ có ở job migrate (App Platform `${pg.DATABASE_URL}` SECRET; VPS service `migrate` theo profile);
  - app dùng `taskflow_app`.
- **Caddy:**
  - không khai `trusted_proxies` ⇒ không tin `X-Forwarded-For` của client, khớp `TRUST_PROXY_HOPS=1`;
  - `/metrics` ở cổng 9464 không có route;
  - Postgres / Valkey không map cổng ra host.
- **Valkey:** TLS + `requirepass` + `noeviction`; image Caddy / Postgres / Valkey pin theo digest.
- **`bootstrap.sh`:** `umask 077`, secret ngẫu nhiên, không đè file đã có.
- **VPS:** runbook có `ufw` 22/80/443, user không phải root, `PasswordAuthentication no`, `PermitRootLogin no`, `unattended-upgrades`.
- **Backup:** role `taskflow_backup` chỉ SELECT; timer `Persistent=true`; heartbeat 26 giờ.

## Chưa kiểm

- Không chạy actionlint / shellcheck / `caddy validate` lại (D báo đã chạy trong `D3-report.md`).
- Chưa đọc `devops.md` §5.2–5.3 phần D sửa.
- Chưa xác minh hành vi `doctl apps spec get` với secret trên tài khoản thật (theo tài liệu DO: trả `EV[…]`).
