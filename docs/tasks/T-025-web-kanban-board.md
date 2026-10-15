# T-025 — Web: bảng Kanban (kéo thả, optimistic update, realtime)

**Giao cho:** Engineer E (`taskflow-enterprise-37`) · **Phase:** 4 · **Phụ thuộc:** T-019 (auth FE + MSW). API thật: route task ở T-024 (A) — làm trên MSW trước, đổi sang API thật khi T-024 merge.

## Nguồn
`docs/design/frontend.md` §1 (board, chi tiết task), §4 (dnd-kit, optimistic, rollback 409, merge socket theo version), §5 (usePermission) · `docs/design/data-and-api.md` §2.7 (route task), §4 (WebSocket `task:*`) · DECISIONS (ADR-010, 011, 041–045, 080, 091, 102).

## Worktree
`../TaskFlow_wt/T-025`, branch `feat/T-025` từ `main` mới nhất (sau khi T-019 merge).

## Việc cần làm
1. Màn danh sách project của workspace + màn board `/w/[wsId]/p/[projectId]` trong route group `(app)` (+ `?task=<taskId>` cho drawer) — theo frontend.md §1.1: URL dùng uuid vì slug đổi được và API định tuyến theo id.
2. Board 4 cột theo `TASK_STATUS_TRANSITIONS` của contracts: cột không hợp lệ bị **chặn thả trước khi gửi** (không gọi API cho bước sai state machine); kéo thả trong cột và giữa cột bằng `@dnd-kit/react`, có điều khiển bàn phím (a11y).
3. Move gửi `{ status?, afterId?, beforeId?, expectedVersion }`; optimistic update **theo từng task** (rollback có điều kiện `cached.version === base.version`); 409 `VERSION_CONFLICT` ⇒ dùng `details.current` + rebase 3 chiều theo frontend.md, 1 lần tự gửi lại; 422 ⇒ rollback + toast.
4. Tạo nhanh task (toolbar), chi tiết task (drawer): sửa title/description/priority/dueDate, gán người (theo quyền ADR-041/044), xóa (ADR-022/045), xem audit log (cursor).
5. Realtime: `useSocket` (websocket-only, handshake token, `auth:renew`/`auth:expired`), `project:join` khi mở board, merge `task:*` vào Query cache theo `version`, bỏ event của chính tab (`X-Client-Id`), tombstone cho task đã xóa, refetch khi reconnect.
6. `usePermission()` ẩn/hiện hành động theo role; VIEWER chỉ xem; project archived ⇒ board chỉ đọc.
7. MSW handler cho toàn bộ route task + mô phỏng socket trong test; test: unit (reducer merge socket, rollback, rebase), component (cột, thẻ, drawer, a11y axe), luồng tích hợp: 2 client giả lập — A kéo thẻ, B thấy thẻ di chuyển.

## Ràng buộc
Component ≤ 150 dòng, ≤ 3 `useState`, không `fetch` trong `.tsx` (máy ép). Board 500 task vẫn mượt (memo; đo và ghi số).

## Phạm vi sở hữu
`apps/web/**`.

## Done
DoD; Lighthouse a11y board ≥ 95; khi T-024 đã merge thì chạy thêm 1 lượt với API thật (dán kết quả). Nhắn `DONE T-025 feat/T-025`.
