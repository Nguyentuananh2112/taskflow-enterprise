# T-031 — Gia cố core/http, cấu hình, logging (findings T-028)

**Giao cho:** Engineer A (`taskflow-enterprise-50`) · **Phase:** 4–5 · **Phụ thuộc:** T-024 đã merge (đã chứa fix M1 regex charset) · nguồn: `docs/reviews/T-028-security-audit.md`

## Việc (mỗi mục có test)
0. **[HIGH — làm đầu tiên] Rò email + hash mật khẩu vào log (B xác nhận trên Postgres thật):** vi phạm CHECK/NOT NULL ⇒ Prisma P2039 mang `err.meta.driverAdapterError.cause.detail` = "Failing row contains (… email, $argon2id$… …)"; `PrismaClientValidationError.message` in cây tham số kèm giá trị. Redact theo key của pino không bắt được. Sửa theo **danh sách cho phép** (allow-list), không danh sách cấm: serializer `err` riêng — lỗi Prisma chỉ giữ `{ name, code, meta.modelName, meta.driverAdapterError.cause.{ kind, originalCode, constraint } }`; ValidationError chỉ giữ `name` + `code`; mọi lỗi không nhận diện ⇒ `name` + `message` đã qua bộ lọc mẫu (email, `$argon2`, chuỗi dài base64/hex) + `stack` chỉ ngoài production. Thêm redact path dự phòng. `details.debug` trả cho client dùng CÙNG serializer. Test: dựng lỗi P2039 từ một dòng thật (email + hash) ⇒ dòng log và response không chứa email/hash; test tương tự cho ValidationError.
1. **M4 / ADR-108** — limiter login theo email: chỉ đếm `401 INVALID_CREDENTIALS` (`countOnlyStatuses`), chạy SAU validate; ngưỡng email 100/giờ; thêm bucket chặt theo cặp `(IP, emailHash)` 10/15 phút. Test: 10 IP gửi sai ⇒ chủ tài khoản vẫn đăng nhập được từ IP của mình cho tới ngưỡng email; body sai định dạng (400) không bị đếm.
2. **L2** — limiter change-password: `failMode: 'closed'` (Valkey chết ⇒ 503), như refresh.
3. **M2** — `/readyz`: cache kết quả probe ~1 giây (một lần kiểm DB/Valkey cho mọi request trong cửa sổ đó), có rate limit riêng; ghi rõ khuyến nghị chặn ở edge/cổng nội bộ trong devops.md (phối hợp D).
4. **L1** — `env.ts`: `APP_ENV ∈ {staging, production}` ⇒ bắt buộc `NODE_ENV=production`; mọi hardening dựa trên APP_ENV; `TRUST_PROXY_HOPS` bắt buộc khai báo tường minh ở prod (≥ 0, có giới hạn trên).
5. **L3** — lỗi phía client không thành 500: URIError path hỏng, body-parser `request.aborted` / `request.size.invalid` / mọi lỗi có `status` 4xx ⇒ map đúng 4xx, log mức `warn` không `error`.
6. **L4** — `Cache-Control: no-store` mặc định cho toàn bộ `/api/v1` (trừ route chủ động cho cache).
7. **L5** — access log ghi `req.path`, KHÔNG ghi query string (tránh `?q=email`).
8. **M3 (phần logger)** — access log có IP (sau trust proxy) + userId (khi đã xác thực); pino mixin gắn `reqId` cho mọi log trong ngữ cảnh request (AsyncLocalStorage). Phần sự kiện `security.*` trong use case auth/workspace do B làm ở T-028.
9. Info: bỏ `gitSha` khỏi `/healthz` công khai (giữ ở log khởi động); timeout từng lệnh cho Valkey client.

## Phạm vi sở hữu
`apps/api/src/core/**`, `apps/api/src/config/**`, `apps/api/src/app.ts`, `docs/design/devops.md` (mục readyz, phối hợp D).

## Done
DoD (exit code); F chạy lại suite đen phần rate-limit + header. Nhắn `DONE T-031 feat/T-031`.
