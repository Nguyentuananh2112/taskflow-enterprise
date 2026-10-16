# Runbook — Deploy staging/production (D3)

**Chủ tài liệu:** Engineer D (DevOps) · **Trạng thái:** sẵn sàng nhưng **CHƯA tạo tài khoản/tài nguyên thật** (ADR-070: người dùng chọn hosting trước Phase 5).
**Liên quan:** `docs/design/devops.md` §1 (so sánh hosting), §4 (migrate/backup), §5.2–5.3 (release/deploy), §9 (checklist go-live) · `docs/runbook/security-go-live.md` (B) · `docs/runbook/backup-restore.md` (B2) · `docs/runbook/alerts.md`.

## 0. Nguyên tắc chung (cả 2 phương án)
1. **Build một lần, deploy theo DIGEST.** `release.yml` build + push `ghcr.io/<owner>/taskflow-{api,web,api-migrate}:sha-<git_sha>` sau khi CI xanh trên `main` (bật bằng biến repo `ENABLE_RELEASE=true`). `deploy.yml` lấy digest của đúng tag đó — không build lại.
2. **Migrate là job RIÊNG, chạy TRƯỚC rollout** (image `api-migrate`: `migrate deploy` + `grant-app.sql`). Lỗi ⇒ dừng, bản cũ vẫn chạy. Migration theo expand/contract (§4.2) ⇒ rollback app không cần rollback DB.
3. **Smoke sau deploy** từ Internet: `/healthz` đúng `gitSha`, `/readyz` có `"db":"ok"`, trang web + `/api/healthz`, header HSTS. Lỗi ⇒ **rollback tự động** về bản trước.
4. **App chạy bằng `taskflow_app` (chỉ DML)** — không bao giờ bằng user migrator/admin.
5. **Staging trước, production sau**, cùng digest. Production có **required reviewers** (người dùng + Tech Lead).

## 1. GitHub (làm 1 lần, dùng chung 2 phương án)
| Mục | Giá trị |
|---|---|
| Biến repo `ENABLE_RELEASE` | `true` khi bắt đầu dùng release (trước đó release.yml không chạy) |
| Environments | `staging`, `production` (Settings → Environments). **Deployment branches** = `main` cho **CẢ** `staging` và `production`; `production` thêm **Required reviewers** = người dùng + Tech Lead. Guard của production chỉ tin deployment `staging` có `task = deploy:smoke-ok` do chính `deploy.yml` tạo sau smoke xanh (không tin deployment GitHub tự tạo — nó mang SHA đầu `main` lúc dispatch, không phải `git_sha`) |
| Biến environment | `API_BASE_URL` (`https://api.<domain>`), `APP_BASE_URL` (`https://app.<domain>`); App Platform: `DO_APP_ID`; VPS: `VPS_HOST`, `VPS_USER` |
| Secret environment | App Platform: `DIGITALOCEAN_ACCESS_TOKEN` (token chỉ scope app cần thiết); VPS: `VPS_SSH_KEY` (khóa riêng cho deploy), `VPS_KNOWN_HOSTS` (`ssh-keyscan <host>` rồi **đối chiếu fingerprint**) |
Thiếu biến/secret ⇒ `deploy.yml` dừng ngay ở bước đầu, in tên thứ còn thiếu.

## A. DigitalOcean App Platform (phương án C — ứng viên mặc định)
### A.1 Tạo hạ tầng (khi người dùng chốt — tốn tiền, devops.md §1.2)
1. Managed PostgreSQL 18, region **sgp1**, tên cụm `taskflow-pg`; Managed Valkey `taskflow-valkey`. Bật **Trusted sources** chỉ cho app (sau khi app tạo).
2. Trong cụm PG: tạo database `taskflow`, user `taskflow_migrator` (App Platform bind user này cho job migrate qua `${pg.DATABASE_URL}`).
### A.2 User app (chỉ DML) — bắt buộc trước lần deploy đầu
Kết nối bằng user quản trị (`doadmin`) — **không** dùng cho app:
```sql
CREATE ROLE taskflow_app LOGIN PASSWORD '<sinh: openssl rand -base64 36>';
ALTER ROLE taskflow_app SET statement_timeout = '10s';
-- Role backup (B2): CHỈ đọc — pg_dump không cần ghi. Không dùng taskflow_app (có ghi) hay doadmin.
CREATE ROLE taskflow_backup LOGIN PASSWORD '<sinh: openssl rand -base64 36>';
GRANT CONNECT ON DATABASE taskflow TO taskflow_backup;
GRANT USAGE ON SCHEMA public TO taskflow_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO taskflow_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO taskflow_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE taskflow_migrator IN SCHEMA public GRANT SELECT ON TABLES TO taskflow_backup;
```
Quyền DML do **job migrate** cấp mỗi lần deploy (`docker/migrate/grant-app.sql`). Thiếu role ⇒ job migrate lỗi rõ ràng (đúng ý đồ).
### A.3 Tạo app lần đầu
```bash
# Thay placeholder (owner GHCR, digest đã release, domain) rồi tạo app:
GIT_SHA=<40 ký tự> API_DIGEST=sha256:… WEB_DIGEST=sha256:… MIGRATE_DIGEST=sha256:… \
yq '(.. | select(tag == "!!str")) |= (sub("__GHCR_OWNER__"; "<owner>") | sub("__API_DIGEST__"; strenv(API_DIGEST))
     | sub("__WEB_DIGEST__"; strenv(WEB_DIGEST)) | sub("__MIGRATE_DIGEST__"; strenv(MIGRATE_DIGEST))
     | sub("__GIT_SHA__"; strenv(GIT_SHA)) | sub("example.com"; "<domain>"))' .do/app.yaml > /tmp/app.yaml
doctl apps create --spec /tmp/app.yaml   # in ra APP_ID → biến environment DO_APP_ID
```
Job `backup` (SCHEDULED, 19:00 UTC = 02:00 giờ VN) cần thêm: `BACKUP_DATABASE_URL` (taskflow_backup, **không** kèm mật khẩu) + `PGPASSWORD` (SECRET), `BACKUP_AGE_RECIPIENTS` (public key age), bucket/endpoint S3 **ngoài DigitalOcean**, credential **PutObject-only**, `BACKUP_HEARTBEAT_URL` (heartbeat uptime monitor gói free — không ping > 26 h ⇒ email). Chi tiết bucket/lifecycle/khóa: `docs/runbook/backup-restore.md` §3–4.

Sau đó điền các env `type: SECRET` đang là `CHANGE_ME` (DATABASE_URL của **taskflow_app**, JWT_ACCESS_SECRET, METRICS_TOKEN, SENTRY_DSN) qua giao diện hoặc `doctl apps update` — DO mã hóa thành `EV[…]`, các lần deploy sau giữ nguyên.
### A.4 Deploy thường xuyên
Actions → **Deploy** → `environment`, `target = do-app-platform`, `git_sha`. Workflow: lấy spec đang chạy → chỉ thay digest + `GIT_SHA` (yq) → `doctl apps update --wait` (job `migrate` PRE_DEPLOY chạy trước) → smoke → lỗi ⇒ áp lại spec trước.

## B. 1 VPS + Docker Compose + Caddy (phương án A — dự phòng giá rẻ)
### B.1 Chuẩn bị máy (Ubuntu 24.04 LTS)
```bash
# Docker Engine + plugin compose theo docs.docker.com/engine/install/ubuntu (repo chính thức, không snap)
ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable
adduser --disabled-password deploy && usermod -aG docker deploy      # user cho GitHub Actions (SSH key riêng)
install -d -m 700 -o deploy /opt/taskflow /opt/taskflow/postgres-init
apt install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
# sshd: PasswordAuthentication no, PermitRootLogin no
# G1 M1 — deploy thuộc nhóm docker ≈ root ⇒ khóa của GitHub Actions bị ép forced command, không có shell:
install -o root -g root -m 755 ci-entry.sh /usr/local/sbin/taskflow-ci-entry     # từ deploy/vps/ci-entry.sh
install -d -m 700 -o deploy ~deploy/.ssh
echo 'restrict,command="/usr/local/sbin/taskflow-ci-entry" ssh-ed25519 AAAA… github-actions-deploy' >> ~deploy/.ssh/authorized_keys
chown deploy ~deploy/.ssh/authorized_keys && chmod 600 ~deploy/.ssh/authorized_keys
```
Khóa CI chỉ chạy được `deploy <sha40> <api> <web> <migrate> [backup] <sha256 compose.prod.yml> <sha256 Caddyfile>` (kiểm định dạng) và `rollback` — **không ghi được file nào**. Mối đe dọa là **khóa lộ** (ssh thẳng, không qua guard/reviewers): nếu khóa ghi được `compose.prod.yml` (service privileged, mount `/:/host`) hoặc `Caddyfile` (reverse_proxy sang máy lạ) thì đó là root VPS / nghe lén mật khẩu. Vì vậy **mọi** file trên VPS — `compose.prod.yml`, `Caddyfile`, `postgres-init/01-roles.sh`, mẫu `.env*.example`, `deploy.sh`, `bootstrap.sh`, unit systemd, `ci-entry.sh` — do **admin cài tay** (khóa SSH riêng của admin, §B.2). `ci-entry.sh` so sha256 của `compose.prod.yml` + `Caddyfile` đang cài với hash CI gửi (tính từ đúng `git_sha`); lệch ⇒ **exit 3** "admin cài lại cấu hình theo commit X" và không deploy. Khóa lộ chỉ deploy/rollback được image đã release từ `main` với cấu hình admin đã cài.
DNS: bản ghi A `app.<domain>` và `api.<domain>` → IP VPS (Caddy xin chứng chỉ Let's Encrypt tự động khi có DNS).
### B.2 Bootstrap (1 lần)
Admin (không phải khóa CI) cài file từ **đúng commit sẽ deploy** — lần đầu và **mỗi khi** `deploy/vps/*` hoặc `docker/postgres/init/01-roles.sh` đổi (deploy báo exit 3 "admin cài lại cấu hình theo commit X" là dấu hiệu):
```bash
git -C ~/taskflow-src fetch && git -C ~/taskflow-src checkout --detach <commit X>   # bản clone chỉ đọc của admin
cd ~/taskflow-src && sudo install -o root -g root -m 644 deploy/vps/{compose.prod.yml,Caddyfile,.env.example,.env.api.example,.env.backup.example,deploy.sh,bootstrap.sh} /opt/taskflow/
sudo install -o root -g root -m 644 docker/postgres/init/01-roles.sh /opt/taskflow/postgres-init/
sha256sum /opt/taskflow/compose.prod.yml /opt/taskflow/Caddyfile   # khớp hash in trong log job Deploy
```
Lần đầu, tiếp:
```bash
cd /opt/taskflow && APP_DOMAIN=app.<domain> API_DOMAIN=api.<domain> ACME_EMAIL=<email> GHCR_OWNER=<owner> bash bootstrap.sh
```
Sinh `.env` + `.env.api` (mật khẩu/secret ngẫu nhiên, quyền 600) và CA/cert TLS cho Valkey (env.ts bắt buộc `rediss://` ở production). Điền `SENTRY_DSN` vào `.env.api` nếu dùng.
### B.3 Deploy
Actions → **Deploy** → `target = vps`. Hoặc trên máy: `bash deploy.sh <git_sha> <api_digest> <web_digest> <migrate_digest>` — ghi digest → pull → **migrate** → rollout api/web → chờ `/readyz` → smoke qua Caddy/HTTPS → lỗi ⇒ tự rollback. Quay về bản trước bằng tay: `bash deploy.sh --rollback`.
### B.4 Sao lưu
Postgres nằm trên chính VPS ⇒ **bắt buộc** sao lưu ra ngoài máy theo `docs/runbook/backup-restore.md` (B2: pg_dump mã hóa age → S3 tương thích, diễn tập khôi phục hằng tuần, cảnh báo 26 h). Snapshot VPS **không** thay được backup DB nhất quán.
```bash
# 1 lần: role chỉ đọc cho backup (SQL như §A.2, chạy bằng user postgres trong container)
docker compose -f compose.prod.yml exec -T postgres psql -U postgres -d taskflow   # dán khối SQL taskflow_backup
cp .env.backup.example .env.backup && chmod 600 .env.backup                       # điền BACKUP_* / AWS_* / heartbeat
install -m 644 taskflow-backup.service taskflow-backup.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now taskflow-backup.timer
systemctl start taskflow-backup.service && journalctl -u taskflow-backup -n 20     # chạy thử ngay 1 lần
```
Diễn tập khôi phục: workflow **Backup restore drill (weekly)** (B2) + diễn tập tay hằng tháng theo `backup-restore.md`.

## C. Sự cố
| Triệu chứng | Xử lý |
|---|---|
| Job migrate lỗi | Bản cũ vẫn chạy. Đọc log job; sửa migration (migration mới, không sửa cái đã apply) ⇒ release + deploy lại |
| Smoke lỗi sau rollout | Đã tự rollback; xem log api (`/readyz` báo gì), Sentry theo `release = <git_sha>` |
| Rollback cũng lỗi | App Platform: Console → Deployments → redeploy bản ACTIVE trước. VPS: sửa `.env` về digest cũ (`.env.previous`) rồi `docker compose -f compose.prod.yml up -d --no-deps api web` |
| Hỏng dữ liệu do migration | PITR (App Platform, 7 ngày) hoặc restore bản dump (VPS) — `backup-restore.md`; deploy SHA cũ |
| `permission denied for table …` | Bước grant chưa chạy ⇒ chạy lại job migrate. **Không** đổi app sang user migrator |

## D. Bằng chứng dry-run (không tài nguyên thật)
Xem `docs/reviews/D3-report.md`: spec render bằng yq, `docker compose config`, `caddy validate`, shellcheck/actionlint, và **lát cắt VPS chạy thật trên máy dev** (domain `localhost`, image build từ repo, NODE_ENV=production).
