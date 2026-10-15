# T-016 — Hạ tầng realtime (Socket.io gateway) + rate limiting

**Giao cho:** Engineer A (`taskflow-enterprise-50`) · **Phase:** 2 · **Phụ thuộc:** main ≥ 92ab432

## Nguồn
`docs/design/security.md` §5 (Socket.io), §6.4 (rate limit — con số theo endpoint), SEC-56 (Origin) · `docs/design/data-and-api.md` §4 (WebSocket contract) · `docs/design/devops.md` §7 (scale, graceful shutdown) · DECISIONS (ADR-027, 063, 074, 097).

## Worktree
`../TaskFlow_wt/T-016`, branch `feat/T-016` từ `main`.

## Việc cần làm (TDD)
1. `core/realtime`: gắn Socket.io vào HTTP server của `server.ts`; transport **chỉ websocket**; `allowRequest` kiểm **Origin** bắt buộc (chống CSWSH); handshake xác thực bằng `AccessTokenAuthenticator` của module auth (qua port/hàm được tiêm, không import nội bộ module); room `user:{id}`, `session:{sid}`, `project:{id}`; vỏ event chung + `clientId` từ handshake.
2. Hiện thực port `IAuthRealtimeNotifier` (auth đã định nghĩa): `disconnectSession(sid)`, `auth:expired`, `auth:renew`, `workspace:access-revoked`, `member:role-changed` theo contract.
3. Cơ chế `project:join` dưới dạng hook có thể tiêm checker membership (module Workspace sẽ cung cấp `IMembershipReader` — dùng interface, fake trong test). Ack `{ ok, code }`.
4. Graceful shutdown: đóng socket trước khi đóng HTTP/Prisma/Valkey (nối vào lifecycle của T-009).
5. Chuẩn bị `@socket.io/redis-adapter` sau cờ cấu hình (tắt mặc định, ADR-027).
6. `core/http/rate-limit`: factory middleware dùng express-rate-limit 8 + rate-limit-redis (Valkey), `ipKeyGenerator` (IPv6 /56), key theo user/email băm khi cần; **fail-closed** cho login/register/refresh khi Valkey lỗi (503), fail-open cho phần còn lại (ADR-074); bảng cấu hình con số theo security.md §6.4; `TRUST_PROXY_HOPS` từ env.
7. Test: Socket.io client thật trong test (in-process), Valkey thật ở cổng 6380 cho integration của rate limit (đánh dấu tầng I).

## Không làm
Route HTTP của auth/workspace (ticket sau), listener realtime của Task.

## Phạm vi sở hữu
`apps/api/src/core/realtime/**`, `apps/api/src/core/http/rate-limit*`, `apps/api/src/server.ts`, `apps/api/src/core/lifecycle/**`, `apps/api/src/config/env.ts` (biến mới), adapter `IAuthRealtimeNotifier` (đặt ở `core/realtime` hoặc `modules/auth/infrastructure/realtime` — ghi lựa chọn trong report).

## Done
DoD; coverage `core/realtime` + rate-limit ≥ 90%; test chứng minh SEC-56 (Origin lạ bị từ chối), handshake token hết hạn/sai bị từ chối, login fail-closed khi Valkey chết. Nhắn `DONE T-016 feat/T-016`.
