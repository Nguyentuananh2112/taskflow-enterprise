# T-024 — HTTP cho Task + realtime listener + test bổ sung từ mutation

**Giao cho:** Engineer A (`taskflow-enterprise-50`) · **Phase:** 3 · **Phụ thuộc:** main ≥ 4bbe537 (T-018, T-021)

## Nguồn
`docs/design/data-and-api.md` §2.7 (route task), §4 (WebSocket payload `task:*`) · `docs/design/security.md` (permission task) · `docs/reviews/T-017-findings.md` §B.3 (survivor của core — phần của bạn) · DECISIONS (ADR-012, 013, 020, 022, 041–045, 091, 102).

## Việc 0 — mutation findings core (commit riêng)
Bổ sung test cho mọi mục **[GAP] P1–P2** ở §B.3 của F: serializer log pino-http (không lộ token/cookie), anchor regex `X-Request-Id`, PATCH/PUT với Content-Type sai ⇒ 415, gỡ handler SIGTERM/SIGINT khi shutdown, `disableOfflineQueue` của Valkey, CORS methods/exposedHeaders. Chạy lại Stryker nhóm core-http, ghi điểm trước/sau (mục tiêu ≥ 85%).

## Việc chính
1. Routes + controller cho mọi endpoint task §2.7 (list theo project, get, create, update, move với `expectedVersion`, assign, delete, audit log cursor), lồng `/workspaces/:wsId/projects/:projectId/tasks` — tenant guard 2 lớp (ADR-020), header `X-Client-Id` → `originClientId`.
2. Realtime listener: domain event Task (sau commit) ⇒ `gateway.emitToProject` đúng payload §4 (DTO đầy đủ + version), bỏ qua người gửi qua `originClientId`.
3. Wiring trong composition root (InMemory hiện tại; Prisma khi T-023 merge).
4. Test HTTP (supertest) + 1 test realtime xuyên container: user A move task ⇒ user B trong phòng project nhận `task:moved`; user ở workspace khác không nhận.
5. Báo QA F (`taskflow-enterprise-bb`) khi route task chạy để F bật các case task trong suite đen.

## Phạm vi sở hữu
`apps/api/src/modules/task/presentation/**`, `apps/api/src/modules/task/task.module.ts`, `apps/api/src/composition/**`, `apps/api/src/core/**` (Việc 0), listener realtime (đặt ở `modules/task/infrastructure/realtime/` — báo C vì đó là thư mục của C, chỉ tạo file mới).

## Done
DoD; F chạy được case task trên branch của bạn (dán kết quả). Nhắn `DONE T-024 feat/T-024`.
