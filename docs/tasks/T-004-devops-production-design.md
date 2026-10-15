# T-004 — Thiết kế vận hành production & CI/CD

**Giao cho:** Engineer D (`taskflow-enterprise-a5`) — QA/DevOps · **Phase:** 0 · **Loại:** tài liệu thiết kế, KHÔNG viết code/config thật

## Bối cảnh
Đọc `docs/TEAM.md`, `docs/blueprint/DECISIONS.md` (ADR-000, 001, 003, 004, 027, 028, 029, 030). Dự án **chạy production thật**, pnpm monorepo (`apps/api` Express 5, `apps/web` Next 16, `packages/contracts`), PostgreSQL + Redis, Socket.io. Giai đoạn đầu 1 instance API nhưng không được chặn đường scale ngang.

## Việc cần làm — viết `docs/design/devops.md` gồm:
1. **Phương án hosting**: so sánh 3 phương án thực tế (vd: 1 VPS + Docker Compose + Caddy/Traefik; PaaS kiểu Railway/Render/Fly; cloud managed: managed Postgres/Redis + container service). Tiêu chí: chi phí/tháng ước tính cho giai đoạn đầu, độ khó vận hành, WebSocket sticky session, backup DB, HTTPS. **Đề xuất 1 phương án** + lý do. Giá cả phải ghi nguồn, đánh dấu nếu không chắc.
2. **Môi trường**: local / staging / production. Biến môi trường từng app (danh sách, cái nào là secret), cách quản lý secret (không commit `.env`), validate env lúc khởi động (Zod).
3. **Docker production**: Dockerfile multi-stage cho api và web (Next `output: standalone`?) — mô tả cấu trúc, user non-root, healthcheck. docker-compose cho local dev (postgres, redis, có thể mailpit).
4. **Database ops**: chạy `prisma migrate deploy` lúc nào (job riêng trước khi rollout, không chạy trong app start), quy tắc migration an toàn (expand/contract, không khóa bảng lớn), backup + thời gian giữ + **diễn tập restore**, connection pooling.
5. **CI/CD (GitHub Actions)**: các job PR (install có cache pnpm, typecheck, lint gồm dependency-cruiser, unit test, integration test với service postgres/redis, build), job main (build image, push registry, deploy staging, deploy production có duyệt tay). Ghi rõ thứ tự & điều kiện chặn merge.
6. **Observability**: log JSON (pino) có requestId, nơi gom log, health/readiness endpoint (`/healthz`, `/readyz` kiểm tra DB+Redis), metrics tối thiểu, error tracking (vd Sentry), cảnh báo nào cần có.
7. **Scale & realtime**: khi lên 2+ instance thì cần gì (redis-adapter Socket.io, sticky session, rate-limit qua Redis, không state trong RAM). Graceful shutdown (SIGTERM: ngừng nhận request, đóng socket, đóng Prisma/Redis).
8. **Chiến lược kiểm thử tổng thể** (vai QA): kim tự tháp test, ngưỡng coverage (domain/application ≥ 80%), cách tạo DB test cô lập, seed dữ liệu, Playwright E2E chạy ở đâu, k6 kịch bản nào để đo P95 (ADR-030).
9. **Checklist go-live**: ≥ 15 mục (HTTPS, cookie Secure, CORS đúng domain, secret xoay vòng, backup đã test restore, rate-limit bật, ...).

## Phạm vi sở hữu (chỉ được ghi)
- `docs/design/devops.md`
- `docs/reviews/T-004-report.md`

## Phối hợp
- Phiên bản thư viện/image: Engineer A (`taskflow-enterprise-50`) đang làm T-001 → `docs/research/stack-versions.md`. Đọc khi có; đừng đoán số phiên bản.
- Rate-limit/cookie/CORS: Engineer B (`taskflow-enterprise-87`, T-002) là người quyết nội dung bảo mật; bạn chỉ lo phần hạ tầng triển khai nó.
- Quyết định lớn (chọn hosting tốn tiền) → đề xuất, Tech Lead `taskflow-enterprise-0b` sẽ hỏi người dùng chốt.

## Hoàn thành khi
Đủ 9 mục; báo cáo xong; SendMessage `DONE T-004` cho `taskflow-enterprise-0b`.
