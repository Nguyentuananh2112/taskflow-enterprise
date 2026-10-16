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
Không tạo tài khoản, không push image, không gọi API DigitalOcean/GitHub thật. Lần kiểm cuối 2026-10-16 trên nhánh đã rebase lên `main` (d647383), sau G1 vòng 2:

| Kiểm | Kết quả |
|---|---|
| `pnpm install --frozen-lockfile` · `pnpm verify` (VITEST_MAX_WORKERS=2, Valkey db 12, REQUIRE_INTEGRATION=1, `VERIFY_DB_URL` = DB mới `taskflow_d3` trên postgres-test) | exit 0 · exit 0 — lint 0, typecheck 0, test 0 (1708 passed), audit 0, prisma validate 0, db:deploy 0, drift 0. Lượt trước đó lint = 1 do prettier quét `load/results/` (kết quả k6 cục bộ, gitignore ở `load/.gitignore` lồng nhau mà prettier không đọc) ⇒ thêm `load/results/` vào `.prettierignore` |
| `actionlint` 1.7.12 (image `rhysd/actionlint`, mọi workflow, gồm release/deploy) | exit 0 |
| `shellcheck` (koalaman/shellcheck:stable) `bootstrap.sh deploy.sh ci-entry.sh` | exit 0 |
| `docker compose -p taskflow-d3check -f compose.prod.yml config -q` (env từ các `.example`, không `up`) · `docker-compose.yml` dev | exit 0; 7 service với profile migrate/backup · exit 0 |
| Render spec App Platform bằng **đúng biểu thức yq của deploy.yml** (mikefarah/yq:4) | exit 0; 4 digest + 2 `GIT_SHA` được thay, không còn placeholder ngoài comment |
| `ci-entry.sh` thử tay (`TASKFLOW_DIR` tạm, `deploy.sh` giả) — sau M1 vòng 2 | hash khớp (có/không backup) ⇒ chuyển đúng `<sha> <digests…>` cho deploy.sh, rc 0; hash lệch 1 hoặc 2 file ⇒ rc 3 kèm tên file + commit; `receive`, `bash -i`, `…;id`, thiếu tham số ⇒ rc 2; `rollback` rc 0, `rollback x` rc 2. `compose.prod.yml`/`Caddyfile` ghim `eol=lf` ⇒ sha256 giống nhau trên runner/máy admin |
| `caddy validate`, `bootstrap.sh` (sinh `.env`/cert Valkey) | xanh (lần kiểm trước rebase) |
| Lát cắt VPS chạy thật trên máy dev (project `taskflow-d3-slice`, Caddy 127.0.0.1:18080/18443) | Postgres + Valkey TLS healthy; **job migrate (`migrate.mjs`) + grant exit 0**. API image cũ (t022) crashloop vì env.ts cũ bắt `SENTRY_DSN` ⇒ **chưa chạy lại** với image mới — việc mở bên dưới |

## Người dùng phải làm khi chốt hosting (ADR-070)
1. Chọn phương án (App Platform hay VPS) + domain (ADR-071).
2. GitHub: biến repo `ENABLE_RELEASE=true`; tạo environment `staging`/`production` (production: required reviewers, chỉ `main`) với biến/secret ở runbook deploy §0.
3. App Platform: tạo Managed PG/Valkey + app từ `.do/app.yaml` (thay `__GHCR_OWNER__`, domain), tạo role `taskflow_app`/`taskflow_backup`, điền secret `CHANGE_ME` một lần; token DO có scope + hạn.
4. VPS: làm runbook §B.1–B.2 (user deploy, `ci-entry.sh` + `authorized_keys restrict,command=`, firewall, bootstrap), DNS A record.
5. Backup: bucket S3 **ngoài** nhà cung cấp hosting, credential PutObject-only, khóa age, heartbeat monitor (runbook backup-restore §3–4).
6. Deploy staging → kiểm → deploy production cùng SHA (job guard bắt buộc thứ tự này).

## Rủi ro còn lại
- **Cấu hình VPS do admin cài tay** (M1 vòng 2) ⇒ thêm 1 bước tay mỗi khi `deploy/vps/*` đổi; quên ⇒ deploy dừng ở exit 3 (an toàn, không deploy lệch cấu hình). Khóa CI lộ chỉ deploy/rollback được image đã release với cấu hình admin đã cài.
- **Bằng chứng staging xanh** là deployment `task=deploy:smoke-ok` — ai có quyền ghi repo cũng tạo được qua API; chấp nhận vì quyền ghi repo đã đủ để sửa workflow (ranh giới thật là required reviewers của production). Chưa chạy thử trên GitHub thật (không tạo tài nguyên).
- Secret: App Platform chỉ nằm ở DO (`EV[…]`); VPS giữ `.env*` quyền 600 trong `/opt/taskflow` (700).
- Chưa PoC App Platform thật (WebSocket qua ingress, PRE_DEPLOY, grace period) — cần tài khoản.

## Đọc chéo đã xử lý
| Nguồn | Mục | Xử lý | Commit |
|---|---|---|---|
| G1 (B) | **H1** `workflow_run` lọc nhánh theo TÊN ⇒ fork có nhánh `main` lọt vào release (packages:write) | job `if`: `workflow_run.event == 'push'` + `head_branch == 'main'` + `head_repository.full_name == github.repository`; dispatch chỉ `refs/heads/main` | `df48c36` |
| G1 | **M1** user deploy ∈ nhóm docker ≈ root | forced command `deploy/vps/ci-entry.sh` (`restrict,command=…`, root sở hữu); deploy.yml bỏ scp/shell | `6856ac8` |
| G1 vòng 2 (B đọc lại @3cb1ba4, Tech Lead đồng ý) | **M1** `receive` cho khóa lộ ghi `compose.prod.yml`/`Caddyfile` ⇒ root VPS / nghe lén | BỎ `receive`; mọi file do admin cài tay (runbook §B.2); CI gửi `deploy <sha40> <digests…> <sha256 compose> <sha256 Caddyfile>`, `ci-entry.sh` so file đang cài, lệch ⇒ exit 3 "admin cài lại cấu hình theo commit X" | `f15f6fc` |
| G1 vòng 2 | **M2** deployment tự tạo cho job `environment:` mang `GITHUB_SHA` (đầu main lúc dispatch — docs "events that trigger workflows": *Last commit on the GITHUB_REF branch*), không phải `inputs.git_sha` ⇒ guard sai 2 chiều | sau smoke staging xanh, job deploy (`deployments: write`) tạo deployment `ref=git_sha`, `environment=staging`, `task=deploy:smoke-ok`, `auto_merge=false`, `required_contexts=[]` + status `success` (`continue-on-error` — lỗi ghi nhận không được kích hoạt rollback); guard lọc `task=deploy:smoke-ok`. Runbook: Deployment branches = `main` cho cả staging và production. Tham số API đối chiếu docs REST "Deployments" (list: `sha`/`task`/`environment`; create: `ref`/`task`/`auto_merge`/`required_contexts`/`environment`) | `f15f6fc` |
| G1 | **M2** "staging trước, chỉ main" chỉ nằm ở runbook | job `guard` trước bước duyệt: ref main; production đòi deployment staging `success` cho đúng SHA (Deployments API) | `f75cc54` |
| G1 | **M3** URL backup có mật khẩu bị backup.sh từ chối; `.env.*.example` bị `.gitignore` chặn | URL không mật khẩu + `PGPASSWORD` (SECRET) ở app.yaml/.env.backup.example/runbook; `!.env.*.example` | `df48c36` |
| G1 | Low: deploy.sh không kiểm sha | `^[0-9a-f]{40}$` | `df48c36` |
| G2 (A) | **O1** `pnpm db:deploy` ở gốc không tồn tại; **O2** migrate trong doc bỏ grant; **O3** target thật là `runtime`/`migrate` | sửa devops.md §3/§4.1/§8; workflow D3 vốn đã dùng `migrate.mjs` (migrate + grant) và target `runtime`/`migrate` | `df48c36` |
| Tự rà sau rebase lên d647383 | Ping heartbeat bằng `wget` nhưng image B2 (`postgres:18.6-bookworm` + age/awscli, `--no-install-recommends`) không có wget/curl (**đã kiểm**: `command -v` trong image nền ⇒ MISSING; `apt-get install -s age awscli` kéo `python3`) ⇒ backup xong vẫn exit 127, không ping ⇒ báo động giả hằng ngày | ping bằng `python3 -c urllib` (URL qua argv, không nội suy vào code) — python3 có sẵn vì awscli Debian chạy trên python3; app.yaml + compose.prod.yml | `f15f6fc` |

Còn mở từ G1 (Low): token DO có scope + hạn; smoke HSTS cho web; trusted sources Managed PG/Valkey; chú thích owner `/opt/taskflow` (bootstrap vs runbook).

## Quyết định tự đưa ra (cần Tech Lead/người dùng duyệt)
1. **Release tắt mặc định** (`ENABLE_RELEASE`) — GHCR miễn phí nhưng vẫn là tài nguyên công khai; chỉ bật khi đã chọn hosting.
2. **App Platform: user migrator được bind tự động, user app là SECRET tạo tay 1 lần** — DO chỉ bind một user/DB; tách quyền (ADR-074) quan trọng hơn tiện lợi.
3. **VPS: Valkey TLS tự ký** thay vì nới `env.ts` cho production (giữ nguyên ràng buộc `rediss://`).
4. **Deploy App Platform giữ spec đang chạy làm gốc** (chỉ thay digest/GIT_SHA) — không ghi đè secret đã mã hóa; `.do/app.yaml` là mẫu tạo lần đầu.
5. **Backup:** App Platform job SCHEDULED / VPS systemd timer chạy script B2; cảnh báo độc lập bằng **heartbeat** uptime monitor (không ping > 26 h ⇒ email) — tương đương "không có `.ok` mới trong 26 h" của B, không cần quyền đọc bucket.

## Việc mở / phụ thuộc
- B APPROVE M1 + M2 vòng 2 (@8155ea0). Không chặn merge: lần deploy staging đầu tiên phải kiểm bước "Ghi nhận staging xanh" xanh + `deployments?task=deploy:smoke-ok` có bản ghi — GitHub có thể từ chối deployment REST `ref`=SHA khi Deployment branches = `main`; phương án dự phòng (environment `staging-smoke`) ghi ở runbook deploy §1.
- B2 (`docker/backup/`) đã vào main ⇒ release build image backup (bước `hashFiles` không còn bỏ qua).
- Lát cắt VPS: chạy lại api/web với image build từ main hiện tại (migrate đã xanh) — làm khi máy rảnh.
- Domain chưa có (ADR-071) ⇒ `example.com` trong spec/runbook.
- Trước Phase 5: PoC App Platform (WebSocket qua ingress, PRE_DEPLOY, grace period) theo devops.md §1.3 — cần tài khoản thật ⇒ người dùng quyết.
