# T-019 — Web: tính năng xác thực (đăng ký, đăng nhập, phiên) trên mock API

**Giao cho:** Engineer E (`taskflow-enterprise-37`) · **Phase:** 4 (sớm) · **Phụ thuộc:** main ≥ 15df624 (nền web + contracts)

## Nguồn
`docs/design/frontend.md` (§1 màn hình, §3 state/auth bootstrap, §7 form) · `docs/design/security.md` (luồng auth phía client, W-TOKEN-1) · `docs/design/data-and-api.md` §2.4 · DECISIONS (ADR-026, 049, 081, 101, 102).

## Worktree
`../TaskFlow_wt/T-019`, branch `feat/T-019` từ `main`.

## Việc 0 — follow-up review T-012 (làm trước, commit riêng)
1. ADR-101: `upgrade-insecure-requests` + HSTS theo `APP_ENV ∈ {staging, production}`, không theo `NODE_ENV`; test cho cả 3 giá trị.
2. ADR-102: `error.code` lạ ⇒ `UNKNOWN_ERROR` giữ `status` + `message`; `BAD_RESPONSE` chỉ khi body không phải envelope. Test cả hai.

## Việc chính
1. Mock API bằng **MSW** (kiểm chứng bản tương thích Next 16/React 19), handler sinh từ schema của `@taskflow/contracts` (request được validate bằng chính schema contracts ⇒ mock không "dễ tính" hơn server thật). Bật được ở dev bằng cờ `APP_MOCK_API=1`; luôn dùng trong test.
2. Auth store (token chỉ trong bộ nhớ — ADR-026), `AuthGate` client, bootstrap bằng `/auth/refresh`, **single-flight refresh** (Web Locks) + đồng bộ đa tab (BroadcastChannel), chỉ refresh khi `TOKEN_EXPIRED`.
3. Màn hình `/login`, `/register` (form dùng Zod của contracts, lỗi `details.issues` hiện theo field, tiếng Việt), đăng xuất, đăng xuất mọi thiết bị, `/me` (sửa họ tên — ADR-083), đổi mật khẩu.
4. Chống lộ: không log token; không lưu token vào storage; dọn state khi `auth:expired`/logout.
5. Test: unit cho store/single-flight/đa tab; component test cho form (a11y với axe); 1 luồng tích hợp trên MSW: đăng ký → vào dashboard rỗng → reload giữ phiên → đăng xuất.

## Không làm
Socket realtime (chờ T-016), Kanban (ticket sau), gọi API thật (chưa có route).

## Phạm vi sở hữu
`apps/web/**`.

## Done
DoD; mọi component ≤ 150 dòng, ≤ 3 useState; Lighthouse a11y `/login`, `/register` ≥ 95. Nhắn `DONE T-019 feat/T-019`.
