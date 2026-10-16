# Runbook — Checklist bảo mật trước khi bật production

**Chủ tài liệu:** Engineer B (bảo mật) · **Dùng khi:** lần đầu bật production, và mỗi lần đổi hạ tầng (domain, hosting, proxy, số instance).
**Quan hệ với tài liệu khác:**
- `docs/design/devops.md` §9 là checklist go-live **chung** (mạng, dữ liệu, vận hành). Runbook này đi sâu phần **bảo mật**: mỗi mục có cách kiểm và bằng chứng cần lưu.
- Khi hai tài liệu lệch nhau, **tài liệu này và `security.md` đúng hơn** — báo Engineer B để đồng bộ.
- Bằng chứng (log, ảnh, link run CI) ghi vào `docs/ops/go-live.md`, kèm người ký.

**Mục CHẶN go-live (G1, 2026-10-15)** — chưa đạt thì **không** bật production, không ngoại lệ: **4.5**, **5.7**, **5.8**, **7.7**. Mục 4.5 chỉ chặn khi chạy > 1 instance.

**Nguyên tắc:** app **tự từ chối khởi động** khi cấu hình production sai ở những chỗ nó kiểm được (`apps/api/src/config/env.ts`). Checklist này phủ phần app **không** tự kiểm được: topology, tài khoản, quy trình.

---

## 1. Secret

| # | Việc | Cách kiểm | Bằng chứng |
|---|---|---|---|
| 1.1 | Sinh **mới** mọi secret cho production, khác staging/local: `openssl rand -base64 48`. | So khớp thủ công: không giá trị nào trùng staging. App từ chối tiền tố `change-me` / `test-only` ở staging / production. | Danh sách tên secret + ngày sinh (không ghi giá trị) |
| 1.2 | `JWT_ACCESS_SECRET` ≥ 32 byte UTF-8. `JWT_ACCESS_SECRET_PREVIOUS` **không đặt** khi không đang xoay khóa. | App từ chối khi < 32 byte hoặc khi `PREVIOUS` trùng secret hiện tại. | Log khởi động không có lỗi env |
| 1.3 | `METRICS_TOKEN` ≥ 32 ký tự — bắt buộc ở **staging và production**. | API từ chối khởi động nếu thiếu. | — |
| 1.4 | Secret chỉ nằm trong **GitHub Environment secrets** (`production`) hoặc env mã hóa của nền tảng. Không có file `.env` thật trên máy dev. Chỉ chủ dự án và Tech Lead đọc được. Agent không bao giờ nhận secret production trong prompt. | Kiểm cài đặt Environment: required reviewers bật. | Ảnh màn hình cài đặt (che giá trị) |
| 1.5 | **Diễn tập xoay `JWT_ACCESS_SECRET` trên staging**: khóa mới làm hiện tại, khóa cũ sang `_PREVIOUS` → deploy → sau ≥ 15 phút bỏ `_PREVIOUS`. | Trong lúc xoay không ai bị đăng xuất (theo dõi tỉ lệ 401 / `TOKEN_EXPIRED`). | Ghi chép diễn tập |
| 1.6 | Lịch xoay: JWT 6 tháng / lần; mật khẩu DB, Valkey, `METRICS_TOKEN` 12 tháng / lần; **ngay lập tức** khi nghi lộ (mục 9). | — | Lịch trong `docs/ops/` |

## 2. Cookie phiên và CORS

| # | Việc | Cách kiểm | Bằng chứng |
|---|---|---|---|
| 2.1 | `COOKIE_SECURE=true` (app từ chối nếu thiếu). Cookie refresh phải là **`__Host-tf_rt; Secure; HttpOnly; SameSite=Strict; Path=/`**, **không** có `Domain` (ADR-109). | `curl -si -X POST https://api.<domain>/api/v1/auth/login -H 'Content-Type: application/json' -H 'Origin: https://app.<domain>' -d '{"email":"<tk test>","password":"…"}' \| grep -i set-cookie` | Output (che giá trị cookie) |
| 2.2 | API chạy trên **origin riêng** (`api.<domain>`). `__Host-` + `Path=/` ⇒ cookie đi kèm mọi request tới API origin, nên không được dùng chung origin với dịch vụ khác. | Kiểm DNS / ingress. | — |
| 2.3 | `CORS_ORIGINS` = đúng `https://app.<domain>` (chỉ origin, https; app từ chối `http://`). | `curl -si -X OPTIONS https://api.<domain>/api/v1/auth/me -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET'` ⇒ **không** có `Access-Control-Allow-Origin`. Lặp lại với origin đúng ⇒ có. | Output 2 lệnh |
| 2.4 | `/auth/refresh` và `/auth/logout` từ chối khi thiếu Origin hoặc Origin lạ (403 `ORIGIN_NOT_ALLOWED`). | Gọi `/auth/refresh` không kèm `Origin` ⇒ 403. | Output |
| 2.5 | Không có subdomain nào của registrable domain do bên thứ ba / nội dung người dùng kiểm soát (CNAME trỏ dịch vụ đã hủy ⇒ nguy cơ takeover). `__Host-` đã chặn cookie tossing, nhưng XSS trên subdomain anh em vẫn nguy hiểm cho người dùng. | Rà bản ghi DNS. | Danh sách subdomain |

## 3. Proxy, IP thật, HTTPS, HSTS

| # | Việc | Cách kiểm | Bằng chứng |
|---|---|---|---|
| 3.1 | `TRUST_PROXY_HOPS` = **đúng số proxy** giữa Internet và app (load balancer, Caddy…), **đo thực tế**. Đặt thiếu ⇒ mọi người dùng chung một IP (rate limit thành DoS toàn cục). Đặt thừa ⇒ kẻ tấn công giả `X-Forwarded-For` để né rate limit. | (a) Gọi bình thường: access log ghi `ip` = IP thật của máy gọi. (b) Gọi kèm `X-Forwarded-For: 1.2.3.4` ⇒ `ip` trong log **không** đổi thành `1.2.3.4`. Làm cho cả HTTP lẫn socket handshake. **Web cũng có `TRUST_PROXY_HOPS`** (mặc định 1, cùng quy tắc với API) — dùng cho rate limit của tunnel `/monitoring`; đặt theo số proxy đứng trước web, có thể khác API. | 2 dòng log + cấu hình web |
| 3.2 | Cổng app **không** truy cập trực tiếp được từ Internet (chỉ qua proxy). Nếu lộ, `X-Forwarded-For` giả sẽ được tin. | `curl` thẳng IP:cổng của app từ ngoài ⇒ phải thất bại. | Output |
| 3.3 | HTTPS cho `app.` và `api.`, HTTP → 301 HTTPS, TLS ≥ 1.2, chứng chỉ tự gia hạn + cảnh báo hết hạn. | `curl -sI http://api.<domain>` ⇒ 301; kiểm TLS bằng SSL Labs hoặc `testssl.sh`. | Kết quả quét |
| 3.4 | **HSTS:** app gửi `max-age` 1 năm + `includeSubDomains` ở staging / production. **Chưa `preload`**. Chỉ cân nhắc preload khi (a) mọi subdomain hiện tại và tương lai đều chạy HTTPS, (b) đã chạy ổn ≥ 3 tháng, (c) chủ dự án đồng ý — gỡ khỏi danh sách preload mất hàng tháng. | `curl -sI https://api.<domain> \| grep -i strict-transport` | Output |
| 3.5 | Web: `APP_ENV=production` đặt **tường minh**; `API_URL` / `WS_URL` là `https://` / `wss://`; mock API tắt (`APP_MOCK_API` không đặt). | Mở web: response có CSP nonce, `Strict-Transport-Security`; gọi `/mock-api/v1/...` ⇒ 404. | Header + output |

## 4. Rate limit và Valkey

| # | Việc | Cách kiểm | Bằng chứng |
|---|---|---|---|
| 4.1 | `REDIS_URL` là `rediss://` (app từ chối nếu không), có mật khẩu, chỉ nhận kết nối từ mạng riêng của app. Nếu dùng chung Valkey với môi trường khác thì phải khác DB index / ACL user. | Thử kết nối Valkey từ ngoài mạng ⇒ thất bại. | Output |
| 4.2 | Login theo **ADR-108**: 20 lần / 15 phút theo IP (trước validate); 10 lần **401** / 15 phút theo (IP, email) và 100 lần 401 / giờ theo email (sau validate). | SEC-28: lần login sai thứ 11 cùng IP + email ⇒ 429 + `Retry-After`; cùng email từ IP khác vẫn đăng nhập được. | Run suite bảo mật |
| 4.3 | Valkey chết ⇒ login / register / refresh / change-password **fail-closed** (503); API thường vẫn chạy (fallback DB cho `tv` / `sid`). | Diễn tập trên staging: dừng Valkey 1 phút. | Ghi chép |
| 4.4 | Chạy **> 1 instance API** ⇒ `SOCKET_REDIS_ADAPTER=true`. Thiếu ⇒ logout-all / xóa thành viên không ngắt socket ở instance khác. Rủi ro đã chấp nhận khi Valkey chết: xem `security.md` §5.4. | Đếm instance; kiểm env. | — |
| 4.5 | **CHẶN khi > 1 instance (ADR-115):** hạn mức realtime theo user — 20 socket / user, 60 `project:join` / phút / user, `auth:renew` 30 / phút / user — phải **đếm dùng chung qua Valkey**. v1 đếm trong bộ nhớ từng instance ⇒ N instance thì trần nhân N. Valkey lỗi ⇒ rơi về hạn mức cục bộ (fail-open có chủ đích), kèm log `warn` + metric. Một instance thì không cần. | Code đếm dùng chung đã merge; trên staging 2 instance: mở 21 socket cùng user chia đều 2 instance ⇒ socket thứ 21 bị `RATE_LIMITED`; dừng Valkey ⇒ thấy log / metric fallback. | Link PR + output |
| 4.6 | **Valkey `maxmemory-policy = noeviction`** (G1 auth I2). Authenticator tin `tv` trong cache mà không hỏi DB về `sid`, nên thu hồi (`auth:sid-revoked:*`, `auth:tv:*`) và bộ đếm limiter **không được bị evict**. Evict = phiên đã thu hồi sống lại tới hết TTL access, limiter bị reset. Hết bộ nhớ ⇒ Valkey trả lỗi ghi (`OOM command not allowed`) ⇒ các luồng ở 4.3 **fail-closed** (503) — đúng thiết kế. **Cấm** đổi sang `allkeys-*` / `volatile-*` để "chữa" OOM: tăng bộ nhớ hoặc tìm khóa rò thay vì đổi policy. | App Platform: API DO của Managed Valkey ⇒ `eviction_policy` = `noeviction` (runbook deploy §A.1). VPS: `valkey-cli INFO memory` ⇒ `maxmemory_policy:noeviction` (runbook deploy §B.2). Cảnh báo bộ nhớ Valkey ≥ 80%. | Output lệnh |

## 5. Database

| # | Việc | Cách kiểm | Bằng chứng |
|---|---|---|---|
| 5.1 | App dùng role **`taskflow_app`** (chỉ DML); migrate dùng **`taskflow_migrator`** (DDL), kết nối thẳng, chỉ trong job migrate. | Bằng `taskflow_app`: `DROP TABLE users;` ⇒ `permission denied`. `SELECT current_user` trong log app ⇒ `taskflow_app`. | Output |
| 5.2 | `ALTER ROLE taskflow_app SET statement_timeout = '10s'`. Pool: `instance × DATABASE_POOL_MAX + 5 ≤ giới hạn kết nối`. | `SHOW statement_timeout` dưới role app. | Output |
| 5.3 | DB chỉ nhận kết nối từ app / job (trusted sources / VPC), TLS bật. | Thử kết nối từ ngoài ⇒ thất bại. | Output |
| 5.4 | `PERSISTENCE` = `prisma` (app từ chối `memory` ở staging / production). Job bảo trì (purge workspace hết hạn) chạy (`MAINTENANCE_JOBS_ENABLED` không đặt hoặc `true`). | Log `maintenance.*` sau giờ đầu. | Dòng log |
| 5.5 | **Backup mã hóa:** PITR bật; `pg_dump -Fc` hằng ngày, mã hóa phía client (age / gpg — khóa riêng **không** lưu cùng chỗ với backup), gửi sang object storage **khác nhà cung cấp**, bucket bật versioning / object lock. Backup / dump **không bao giờ** vào repo hay artifact CI (repo public — ADR-072). | Liệt kê bucket: file có đuôi `.age` / `.gpg`; thử đọc không có khóa ⇒ không đọc được. | Danh sách object |
| 5.6 | **Đã diễn tập restore** (PITR và logical) — backup chưa từng restore coi như chưa có. | `restore-drills.md` | Kết quả diễn tập |
| 5.7 | **CHẶN:** diễn tập backup / restore tự động (B2) **xanh trên bản đã sửa theo review G1** (`fix/B2-backup-review`: object lock bắt buộc, chọn bản trước thời điểm bị chiếm, mật khẩu DB qua `PGPASSWORD` thay vì argv). Bản sửa chưa merge — đang chờ người dùng duyệt chạy docker. Sau merge, bucket thật phải bật **versioning + object lock (compliance, ≥ 14 ngày)** ngay lúc tạo (5.5 không còn là "nếu hỗ trợ"). | Run `backup-drill.yml` xanh trên commit đã merge bản sửa; `aws s3api get-object-lock-configuration` trên bucket thật ⇒ `COMPLIANCE`. | Link run + output |
| 5.8 | **CHẶN:** job dọn `refresh_tokens` (G2 S2 — token hết hạn / thu hồi quá hạn giữ) **đã chạy ít nhất 1 lượt trên staging**. Thiếu job thì bảng (có `ip`, `user_agent`) tăng mãi. | Log `maintenance.*` của job sau lượt đầu, có số dòng đã xóa; `SELECT count(*) FROM refresh_tokens WHERE expires_at < now() - interval '<hạn giữ>'` ⇒ 0. | Dòng log + output |

## 6. Log, Sentry, metrics

| # | Việc | Cách kiểm | Bằng chứng |
|---|---|---|---|
| 6.1 | Log không chứa mật khẩu / token / cookie / email ngoài chỗ được phép. Lỗi DB đi qua serializer allow-list (T-031 mục 0) — không có dòng dữ liệu, không có hash. | Sau E2E trên staging: `grep -E '\$argon2\|tf_rt=\|Bearer ' log` ⇒ rỗng (SEC-33). | Output grep |
| 6.2 | Sự kiện bảo mật có `reqId` + `ip`: `auth.login_failed`, `auth.logout_all`, `auth.password_changed`, `auth.password_change_failed`, `auth.refresh_cookie_ambiguous`, `refresh.reuse_detected`, `member.added` / `role_changed` / `removed`, `workspace.deleted` / `restored` / `slug_changed`. Cảnh báo: `refresh.reuse_detected` tăng; `rate_limit_blocked_total{rule="login"}` > 50 / 5 phút. | Tạo một lần login sai trên staging ⇒ tìm được theo `reqId`. | Dòng log |
| 6.3 | **`SENTRY_DSN`** (API và web): thiếu ⇒ app vẫn chạy, chỉ **cảnh báo**; staging / production bắt buộc `https://`; thu thập tắt tại nguồn + `beforeSend` allow-list — chi tiết dưới bảng. | (a) Log khởi động API và web **không** có cảnh báo thiếu / sai DSN. (b) Gửi lỗi thử từ API và từ trình duyệt ⇒ event có đúng `release` / `environment`, **không** có email, token, cookie, body, query string. | Dòng log + ảnh event |
| 6.4 | `/metrics` chạy trên **cổng riêng** `METRICS_PORT` (mặc định 9464, phải khác `PORT`), chỉ `GET /metrics`, **luôn** đòi `Authorization: Bearer METRICS_TOKEN` ở staging / production. `METRICS_HOST` mặc định **`127.0.0.1`** — chỉ đặt `0.0.0.0` khi bộ scrape nằm ngoài container, và khi đó cổng **không** được công bố ra Internet. | (a) `curl https://api.<domain>/metrics` ⇒ 404 (route không tồn tại trên cổng công khai). (b) Từ ngoài, kết nối `<host>:9464` ⇒ thất bại. (c) Trong mạng nội bộ, không kèm token ⇒ 401; kèm token ⇒ 200. | Output 3 lệnh |
| 6.5 | `/healthz` không lộ `gitSha` / phiên bản; `/readyz` chỉ trả trạng thái, chặn ở edge nếu được (tránh flood vào pool DB). | `curl` 2 endpoint. | Output |
| 6.6 | **Tunnel Sentry `/monitoring` của web** (cùng origin ⇒ không nới CSP `connect-src`): chỉ chuyển tiếp tới **DSN đã cấu hình** (envelope mang DSN khác ⇒ 403, không phải proxy mở / SSRF); đọc body theo luồng, trần 200 kB (chunked không có `Content-Length` vẫn bị cắt ⇒ 413); rate limit 30 / phút / IP + 300 / phút / instance; chỉ chuyển item loại `event`. Không có DSN ⇒ route trả 404. | (a) Gửi envelope có DSN khác ⇒ 403. (b) Gửi body chunked > 200 kB ⇒ 413. (c) 31 request / phút từ một IP ⇒ 429 `Retry-After`. | Output |


**Chi tiết 6.3 — Sentry (T-035):**
- **Thiếu DSN** ⇒ API và web vẫn chạy, chỉ **cảnh báo** lúc khởi động (giám sát không được làm sập app). App **không** tự chặn chỗ này ⇒ phải kiểm log khởi động.
- Staging / production **bắt buộc `https://`**: API từ chối khởi động; web **tắt Sentry** và cảnh báo một lần (không làm hỏng mọi trang).
- Thu thập tắt tại nguồn (`dataCollection`: user, cookie, header, body, query, biến cục bộ, dòng mã nguồn); không breadcrumb, không session.
- `beforeSend` / `beforeSendTransaction` dựng event mới theo **allow-list**, cùng serializer với log (lỗi DB không mang dòng dữ liệu). Web: URL bỏ query (`?next=`, `?task=`), `tracePropagationTargets: []`, SDK chỉ nạp khi có DSN.

## 7. Repo public, CI, tài khoản

| # | Việc | Cách kiểm | Bằng chứng |
|---|---|---|---|
| 7.1 | **gitleaks quét toàn bộ lịch sử** xanh trên commit sẽ deploy (job CI trên `main`). | Link run CI. | Link |
| 7.2 | GitHub **Secret scanning + Push protection** bật; Dependabot alerts bật; **Private vulnerability reporting bật** (mặc định TẮT — `SECURITY.md` dựa hoàn toàn vào kênh này để nhận báo lỗ hổng riêng tư). | Cài đặt repo → Code security: ba mục đều Enabled; mở tab Security ⇒ có nút "Report a vulnerability". | Ảnh |
| 7.3 | Branch protection trên `main` (PR bắt buộc, CI xanh, không force push); Environment `production` có required reviewers; workflow PR từ fork không có secret. | Cài đặt repo. | Ảnh |
| 7.4 | 2FA bắt buộc cho mọi tài khoản: GitHub, hosting, GHCR, Sentry, DNS / registrar, uptime monitor, object storage backup. | Danh sách tài khoản + trạng thái 2FA. | Bảng |
| 7.5 | Image public trên GHCR không chứa secret: Trivy `vuln,secret` xanh; `docker history` không có `ENV`/`ARG` chứa secret. | Run CI Trivy. | Link |
| 7.6 | `pnpm audit --prod`: không advisory nào mở ngoài danh sách đã chấp nhận (`pnpm-workspace.yaml` `auditConfig`), và mọi mục chấp nhận còn hạn xem lại. | Chạy lệnh. | Output |
| 7.7 | **CHẶN: KHÔNG bật `ENABLE_RELEASE`** (biến repo của `release.yml`) trước khi sửa G1-D3 H1 **đã vào `main`**: release chỉ chạy cho `workflow_run.event == 'push'` từ **chính repo** (`head_repository.full_name == github.repository`) trên nhánh `main`. Nếu không, PR từ fork có nhánh tên `main` đẩy được image do người ngoài build lên GHCR chính thức. | Sau merge, mở **PR thử từ một fork** với nhánh tên `main` ⇒ CI chạy, workflow Release **bị bỏ qua** (skipped), GHCR không có tag `sha-<sha của fork>`. Xóa fork thử sau đó. | Link run CI + run Release (skipped) |
| 7.8 | **CHẶN trước lần deploy production đầu tiên — cấu hình 2 Environment** (G1-D3 M2). Guard `main`-only trong `deploy.yml` chỉ có tác dụng khi chạy đúng file của `main`: `workflow_dispatch` từ nhánh khác dùng file workflow **của nhánh đó** (xóa được guard). Vì vậy cả `staging` **và** `production`: **Deployment branches = `main`**. `production`: **Required reviewers** = người dùng + Tech Lead, không cho tự duyệt. Secret deploy (`VPS_SSH_KEY`, `DIGITALOCEAN_ACCESS_TOKEN`, …) chỉ đặt ở **environment**, **không bao giờ** ở repo-level. | Settings → Environments → từng environment: kiểm 3 mục trên; Settings → Secrets and variables → Actions → tab *Repository secrets* không có secret deploy. Thử `workflow_dispatch` Deploy từ một nhánh khác `main` ⇒ job bị từ chối trước khi chạy. | Ảnh 2 environment + ảnh Repository secrets (che giá trị) + link run bị từ chối |

## 8. Kiểm thử bảo mật trên commit sẽ deploy

| # | Việc | Bằng chứng |
|---|---|---|
| 8.1 | Suite bảo mật hộp đen (`pnpm --filter @taskflow/api test:security`, gồm ADR-109 cookie, X2/X4/X5/X8, SEC-24b/e/f) xanh **3 lần liên tiếp**. | Link run |
| 8.2 | Unit + integration + E2E xanh, kiểm exit code. | Link run |
| 8.3 | ZAP baseline trên staging: không có cảnh báo High. | Báo cáo ZAP |
| 8.4 | Không còn finding High / Medium mở trong `docs/reviews/T-028-security-audit.md` và các review sau đó. | Bảng trạng thái |

---

## 9. Phản ứng sự cố: lộ secret

**Nguyên tắc:** repo public ⇒ secret đã lên GitHub (kể cả commit đã xóa, fork, PR đóng) **coi như đã bị lộ**. Việc đầu tiên luôn là **xoay** secret; xóa khỏi lịch sử chỉ là bước phụ.

### 9.1 Ngay lập tức (≤ 1 giờ)
1. **Ghi nhận:** ai phát hiện, lúc nào, secret nào, lộ ở đâu (commit / log / ảnh chụp / tin nhắn). Mở ticket sự cố, báo chủ dự án và Tech Lead.
2. **Xoay theo loại** (bảng dưới). Deploy ngay, không chờ release.
3. **Thu hồi phiên** nếu secret liên quan xác thực (bảng dưới).

| Secret lộ | Xoay | Thu hồi / hệ quả |
|---|---|---|
| `JWT_ACCESS_SECRET` | Đặt secret mới. **KHÔNG** chuyển khóa cũ sang `_PREVIOUS` (kẻ tấn công đang ký được token bằng nó). | Mọi access token cũ ⇒ 401. FE tự refresh bằng cookie (refresh token là chuỗi ngẫu nhiên lưu dạng hash trong DB, không phụ thuộc JWT secret) ⇒ người dùng hầu như không bị gián đoạn. Token giả mạo hết hiệu lực ngay khi deploy. |
| Mật khẩu DB (`taskflow_app` / `taskflow_migrator`) | `ALTER ROLE … PASSWORD …`, cập nhật secret, deploy. | Rà log kết nối Postgres tìm kết nối lạ; nếu nghi dữ liệu bị đọc ⇒ mục 9.2. |
| Mật khẩu / URL Valkey | Đổi mật khẩu (ACL), cập nhật secret, deploy. | Valkey chỉ chứa cache / bộ đếm, nhưng ai ghi được Valkey có thể xóa khóa thu hồi (`sid-revoked`) hoặc giả event realtime ⇒ sau khi xoay, coi như cần thu hồi mọi phiên (mục 9.2 bước 2). |
| `METRICS_TOKEN` | Sinh mới, deploy. | Chỉ lộ số liệu vận hành. |
| `SENTRY_DSN` | Tạo DSN mới, xóa DSN cũ trong Sentry. | Rủi ro là spam event / tốn quota. |
| Token GitHub / GHCR / hosting / DNS | Thu hồi token ngay trên trang nhà cung cấp, tạo mới với quyền tối thiểu. | Rà audit log của nhà cung cấp (deploy lạ, đổi DNS, image lạ trên GHCR). |
| Khóa giải mã backup | Tạo cặp khóa mới; backup mới mã hóa bằng khóa mới; xóa / mã hóa lại backup cũ nếu kẻ tấn công có thể đã lấy được cả file. | Nếu file backup cũng có khả năng bị lấy ⇒ coi như **lộ dữ liệu** (mục 9.2). |

### 9.2 Nếu nghi dữ liệu người dùng / phiên bị lộ
1. **Phạm vi:** bảng / khoảng thời gian / nguồn nào. Mật khẩu chỉ lưu dạng argon2id; refresh token chỉ lưu SHA-256 của chuỗi 256-bit ⇒ dump DB **không** chứa token dùng được trực tiếp, nhưng email và hash mật khẩu vẫn là dữ liệu cá nhân.
2. **Thu hồi mọi phiên** (một transaction, chạy bằng `taskflow_migrator`, ghi lại người chạy):
   ```sql
   BEGIN;
   UPDATE users SET token_version = token_version + 1;
   UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'LOGOUT_ALL' WHERE revoked_at IS NULL;
   COMMIT;
   ```
   Sau đó xóa cache phiên trên Valkey (`auth:tv:*`) hoặc chờ ≤ 60s cho TTL — access token cũ hết hiệu lực trong ≤ 60s.
3. **Mật khẩu:** nếu hash có thể đã lộ ⇒ yêu cầu đặt lại mật khẩu cho người dùng bị ảnh hưởng. Tính năng reset qua email chưa có ở v1 ⇒ quyết định cách liên hệ với chủ dự án.
4. **Thông báo:** chủ dự án quyết định thông báo người dùng / cơ quan theo luật áp dụng (dữ liệu cá nhân). Ghi lại quyết định.

### 9.3 Sau sự cố (≤ 5 ngày)
- Xóa secret khỏi lịch sử git **nếu** đáng (git-filter-repo + yêu cầu GitHub xóa cache), biết rằng việc này **không** thay thế việc xoay.
- Tìm nguyên nhân: tại sao gitleaks pre-commit / CI / push protection không chặn được? Thêm rule hoặc test.
- Postmortem ngắn trong `docs/ops/incidents/`: dòng thời gian, phạm vi, việc đã làm, việc phòng ngừa. Không ghi giá trị secret.
