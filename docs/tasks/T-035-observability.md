# T-035 — Observability: Sentry (API + web), metrics, cảnh báo

**Giao cho:** Engineer A (`taskflow-enterprise-50`) · **Phase:** 5 (trước deploy) · **Phụ thuộc:** main ≥ 8d41ff3

## Nguồn
DECISIONS ADR-073 (Sentry gói miễn phí + cảnh báo email), ADR-096, T-031 mục 0 (serializer allow-list) · `docs/design/devops.md` §6 · finding Info của T-028 ("Sentry/metrics bắt buộc ở env prod nhưng chưa nối").

## Việc
1. **Sentry API**: SDK Node bản ổn định ≥ 24h tuổi; khởi tạo chỉ khi có `SENTRY_DSN`; `beforeSend` dùng **cùng serializer allow-list của T-031** (không gửi email/hash/token/cookie/body/query) — test: lỗi P2039 từ dòng thật ⇒ payload gửi Sentry không chứa email/hash; gắn `reqId`, `release` (git SHA lúc build), `environment` = APP_ENV; sampling trace thấp (vd 0.05) cấu hình qua env.
2. **Sentry web**: SDK Next 16 phía client + server; **không phá CSP** (kiểm `connect-src` cho ingest Sentry qua runtime config, nonce cho script nếu SDK cần — ưu tiên tunnel route same-origin để khỏi nới CSP); không gửi PII (sendDefaultPii=false, scrub URL query).
3. **Metrics tối thiểu** (devops.md §6): endpoint `/metrics` định dạng Prometheus **chỉ nghe ở cổng nội bộ riêng** (không qua route công khai): request count/latency theo route template (không theo URL thật), lỗi theo code, pool DB đang dùng, số socket, kết quả job bảo trì (T-033).
4. **Cảnh báo email** (ADR-073): mô tả cấu hình cảnh báo Sentry (lỗi mới, tăng đột biến) + uptime monitor miễn phí trỏ `/readyz` — viết vào `docs/runbook/alerts.md` (cấu hình trên dashboard dịch vụ — hướng dẫn từng bước cho người dùng, KHÔNG tự tạo tài khoản).
5. Thiếu `SENTRY_DSN` ở staging/production ⇒ cảnh báo lúc khởi động (không chặn khởi động — giám sát không được làm sập app); env.ts + `.env.example` cập nhật.

## Phạm vi sở hữu
`apps/api/src/core/**`, `apps/api/src/config/**`, `apps/api/src/main.ts`, `apps/web` phần khởi tạo Sentry (`instrumentation*.ts`, `next.config` — phối hợp E, báo trước), `docs/runbook/alerts.md`, `docs/design/devops.md` §6 (phối hợp D).

## Done
DoD (exit code); test chứng minh không rò PII; F chạy SEC-48 (CSP) trên build prod sau khi gắn Sentry web. Nhắn `DONE T-035 feat/T-035`.
