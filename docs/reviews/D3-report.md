# D3 — Báo cáo: chuẩn bị deploy KHÔNG tốn tiền cho 2 phương án hosting

**Người làm:** Engineer D (`taskflow-enterprise-a5`) · **Branch:** `feat/D3-deploy-prep` · **Ngày:** 2026-10-15
**Căn cứ:** BACKLOG D3 (ADR-112), ADR-070 (chọn hosting trước Phase 5), devops.md §1/§4/§5, B2 (backup) của B.
**Ràng buộc đã giữ:** không tạo tài khoản/tài nguyên cloud thật, không push, không đụng compose dùng chung.

## Đã làm
| File | Nội dung |
|---|---|
| `.do/app.yaml` | App Platform (phương án C, region `sgp`): service `api` (2 GiB — argon2id; `/readyz` readiness, `/healthz` liveness, termination drain 10 s / grace 40 s), `web`, job **PRE_DEPLOY** `migrate` (`node migrate.mjs` = migrate deploy + grant), job **SCHEDULED** `backup` (19:00 UTC), Managed PG 18 + Valkey (cluster production, bind `${pg.DATABASE_URL}` chỉ cho migrate), ingress theo domain, alert CPU/RAM/restart/deploy. Image theo **digest** GHCR; secret = `CHANGE_ME` (điền 1 lần, DO mã hóa `EV[…]`). Tên trường đối chiếu App Spec reference chính thức |
| `deploy/vps/compose.prod.yml` | Phương án A: Caddy 2.11.7 (HTTPS tự động) + api + web + `migrate` (profile) + Postgres 18.6 + Valkey 9.1.2 **TLS** (env.ts bắt buộc `rediss://` ở production; api tin CA qua `NODE_EXTRA_CA_CERTS`) + `backup` (profile). Mọi image ghim digest; không map cổng DB/Valkey ra ngoài; log xoay vòng |
| `deploy/vps/Caddyfile` | 2 site `{$APP_DOMAIN}`/`{$API_DOMAIN}`, health check upstream, gzip/zstd; không `trusted_proxies` (Caddy là proxy ngoài cùng — không tin XFF client) |
| `deploy/vps/bootstrap.sh` | 1 lần trên VPS: sinh `.env`/`.env.api` (secret ngẫu nhiên, umask 077) + CA/cert Valkey (SAN `valkey`, `localhost`, `127.0.0.1`) |
| `deploy/vps/deploy.sh` | Theo digest: ghi `.env` (giữ `.env.previous`) → pull → **migrate job** → rollout api/web → chờ `/readyz` → smoke qua Caddy/HTTPS → lỗi ⇒ **tự rollback**; `--rollback` bằng tay; validate định dạng digest |
| `deploy/vps/.env.example`, `.env.api.example`, `.env.backup.example` | mẫu (giá trị `change-me…` — env.ts từ chối ở production) |
| `deploy/vps/taskflow-backup.{service,timer}` | systemd: backup hằng ngày 19:00 UTC, `Persistent=true` (bù lượt lỡ) |
| `.github/workflows/release.yml` | Sau CI xanh trên main (`workflow_run`) — **tắt mặc định**, chỉ chạy khi biến repo `ENABLE_RELEASE=true`. Build + push 3 image (+ backup nếu có Dockerfile của B2) tag `sha-<git_sha>`, provenance + SBOM, digest vào summary + artifact |
| `.github/workflows/deploy.yml` | `workflow_dispatch` (environment staging/production × target do-app-platform/vps × git_sha). Environment protection (production: required reviewers + chỉ main). Kiểm cấu hình thiếu ⇒ dừng sớm có hướng dẫn. Lấy digest (không build lại). App Platform: `doctl apps spec get` → yq thay digest + GIT_SHA → `update --wait` → smoke → lỗi ⇒ áp lại spec cũ. VPS: scp file deploy → `deploy.sh` → smoke từ Internet → lỗi ⇒ `--rollback`. SSH ghim host key |
| `docs/runbook/deploy.md` | Nguyên tắc chung, cấu hình GitHub, từng bước cho 2 phương án (tạo hạ tầng khi người dùng chốt, role `taskflow_app` chỉ DML + `taskflow_backup` chỉ SELECT, tạo app lần đầu, bootstrap VPS, firewall, backup timer), bảng sự cố |
| `docs/design/devops.md` §5.2–5.3 | thay mô tả cũ bằng workflow thật |
| `docs/tasks/BACKLOG.md` | D3 "Đang làm: D" |

## Kiểm chứng (không tài nguyên thật)
<!-- KẾT QUẢ -->

## Đọc chéo đã xử lý
| Nguồn | Mục | Xử lý | Commit |
|---|---|---|---|
| G1 (B) | **H1** `workflow_run` lọc nhánh theo TÊN ⇒ fork có nhánh `main` lọt vào release (packages:write) | job `if`: `workflow_run.event == 'push'` + `head_branch == 'main'` + `head_repository.full_name == github.repository`; dispatch chỉ `refs/heads/main` | `7027b06` |
| G1 | **M1** user deploy ∈ nhóm docker ≈ root | forced command `deploy/vps/ci-entry.sh` (`restrict,command=…`, root sở hữu): chỉ `receive` (tar, allowlist file cấu hình) / `deploy <sha40> <digest…>` / `rollback`; deploy.yml bỏ scp/shell. deploy.sh, bootstrap.sh, unit systemd: admin cài tay | `0bee5ce` |
| G1 | **M2** "staging trước, chỉ main" chỉ nằm ở runbook | job `guard` trước bước duyệt: ref main; production đòi deployment staging `success` cho đúng SHA (Deployments API) | `b7bab0d` |
| G1 | **M3** URL backup có mật khẩu bị backup.sh từ chối; `.env.*.example` bị `.gitignore` chặn | URL không mật khẩu + `PGPASSWORD` (SECRET) ở app.yaml/.env.backup.example/runbook; `!.env.*.example` | `7027b06` |
| G1 | Low: deploy.sh không kiểm sha | `^[0-9a-f]{40}$` | `7027b06` |
| G2 (A) | **O1** `pnpm db:deploy` ở gốc không tồn tại; **O2** migrate trong doc bỏ grant; **O3** target thật là `runtime`/`migrate` | sửa devops.md §3/§4.1/§8; workflow D3 vốn đã dùng `migrate.mjs` (migrate + grant) và target `runtime`/`migrate` | `7027b06` |

Còn mở từ G1 (Low): token DO có scope + hạn; smoke HSTS cho web; trusted sources Managed PG/Valkey; chú thích owner `/opt/taskflow` (bootstrap vs runbook).

## Quyết định tự đưa ra (cần Tech Lead/người dùng duyệt)
1. **Release tắt mặc định** (`ENABLE_RELEASE`) — GHCR miễn phí nhưng vẫn là tài nguyên công khai; chỉ bật khi đã chọn hosting.
2. **App Platform: user migrator được bind tự động, user app là SECRET tạo tay 1 lần** — DO chỉ bind một user/DB; tách quyền (ADR-074) quan trọng hơn tiện lợi.
3. **VPS: Valkey TLS tự ký** thay vì nới `env.ts` cho production (giữ nguyên ràng buộc `rediss://`).
4. **Deploy App Platform giữ spec đang chạy làm gốc** (chỉ thay digest/GIT_SHA) — không ghi đè secret đã mã hóa; `.do/app.yaml` là mẫu tạo lần đầu.
5. **Backup:** App Platform job SCHEDULED / VPS systemd timer chạy script B2; cảnh báo độc lập bằng **heartbeat** uptime monitor (không ping > 26 h ⇒ email) — tương đương "không có `.ok` mới trong 26 h" của B, không cần quyền đọc bucket.

## Việc mở / phụ thuộc
- B2 (`docker/backup/`) chưa merge ⇒ bước build image backup trong release tự bỏ qua; deploy giữ image backup hiện có khi chưa có tag.
- Domain chưa có (ADR-071) ⇒ `example.com` trong spec/runbook.
- Trước Phase 5: PoC App Platform (WebSocket qua ingress, PRE_DEPLOY, grace period) theo devops.md §1.3 — cần tài khoản thật ⇒ người dùng quyết.
