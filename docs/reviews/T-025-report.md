# T-025 — Báo cáo: bảng Kanban (kéo thả, optimistic update, realtime) trên mock API

**Người làm:** Engineer E (session `taskflow-enterprise-54`, thay `-37`) · **Branch:** `feat/T-025` (rebase lên main `f1355ce`, đã gồm T-029) · **Ngày:** 2026-10-15
Giữa chừng tạm dừng để làm T-029 (đã merge `689decd`). Đã rebase: xung đột ở `mock-api/index.ts`, `auth-handlers.ts`, `respond.ts` được gộp cả hai phía (guard Content-Type/Origin của T-029 + handler board của T-025); `session.ts` tự gộp (cờ logout-pending + `realtimeAuth`).
ADR-109 (`__Host-tf_rt`): API hiện vẫn đặt `tf_rt` không Secure ở dev http (`refresh-cookie.ts`), mock giả lập môi trường dev nên giữ `tf_rt` + `Path=<base>/auth`; FE không đọc cookie nên không phải sửa.

## 1. Đã làm (theo 7 việc của ticket)
1. **Route** (`app/(app)/w/…`): `/w/[wsId]` ⇒ redirect `/projects`; `/w/[wsId]/projects` (tab Đang hoạt động / Đã lưu trữ, cursor); `/w/[wsId]/p/[projectId]` (+ `?task=`) — uuid, không slug. Id sai định dạng ⇒ màn "Không tìm thấy hoặc bạn không có quyền truy cập" (không gọi API). `/w` giờ link tới danh sách project.
2. **Board 4 cột** theo `TASK_STATUS_TRANSITIONS` của contracts. Chặn thả 3 lớp (frontend.md §4.2): droppable/sortable `disabled` (cột mờ + ⊘ + lý do cho trình đọc màn hình), `preventDefault` ở `dragover`, kiểm lại ở `dragend` (sai ⇒ không gọi API). `@dnd-kit/react` 0.5.0 với tay kéo riêng (bàn phím Space/mũi tên/Escape từ `KeyboardSensor` mặc định), thông báo tiếng Việt qua plugin `Accessibility`, `DragOverlay`, tắt animation khi `prefers-reduced-motion`. **Đường thay thế không cần kéo** (WCAG 2.5.7): menu "⋯" — "Chuyển tới ▸ (chỉ cột hợp lệ)", "Lên đầu / Xuống cuối cột"; Select "Trạng thái" trong drawer. Mọi đường đi qua cùng `useMoveTask`.
3. **Move**: gửi `{ expectedVersion, status?, afterId, beforeId }` (không gửi rank); `expectedVersion` lấy lúc thả. Optimistic **theo từng task** (rank tạm, giữ version cũ); rollback có điều kiện `cached.version === base.version`. 409 ⇒ `details.current`: người khác chỉ sửa nội dung ⇒ tự gửi lại đúng 1 lần; đã di chuyển ⇒ hiện vị trí thật + toast. 422/403/404/mạng/5xx theo bảng §4.4. Thẻ đang chờ bị khóa kéo (`useMutationState`).
4. **Tạo nhanh** (toolbar). **Drawer**: sửa tiêu đề/mô tả/ưu tiên/hạn chót với **rebase 3 chiều** (không xung đột ⇒ tự gửi lại; xung đột ⇒ khối vàng "Xem bản mới nhất / Giữ bản của tôi / Bỏ thay đổi của tôi"; field người khác vừa đổi được đánh dấu); `scope: task:<id>` để các lần lưu cùng task chạy tuần tự. **Gán người** theo ADR-041/044 (PM+/người tạo: picker chỉ role ≥ MEMBER; MEMBER khác: "Nhận việc"/"Bỏ nhận"; `ASSIGNEE_NOT_MEMBER` ⇒ toast + làm mới danh sách). **Xóa** (ADR-022/045): optimistic, gửi `expectedVersion`, 409 ⇒ "Vẫn xóa?". **Lịch sử** (audit, cursor "Tải thêm"). Focus trả về thẻ khi đóng drawer.
5. **Realtime**: `shared/socket` (nơi duy nhất import `socket.io-client`) — chỉ websocket, `autoConnect: false`, token + clientId trong callback `auth` (không query string); `connect_error TOKEN_EXPIRED` ⇒ refresh rồi nối lại; `UNAUTHORIZED` ⇒ kết thúc phiên; lỗi transport/Origin ⇒ không kết thúc phiên; `auth:expired` ⇒ refresh; server ngắt ⇒ refresh + connect; có token mới ⇒ `auth:renew`; tab hiện lại ⇒ ép connect. `RealtimeProvider` (src/app) tạo socket sau đăng nhập, ngắt khi phiên kết thúc. `useBoardRealtime`: `project:join`/`leave`, ack 404 ⇒ màn Không tìm thấy; merge `task:*` bằng reducer thuần (khử trùng `eventId` LRU 500, bỏ event của chính tab theo `originClientId`, chỉ nhận version lớn hơn, tombstone); payload parse bằng schema contracts; `project:updated` ⇒ board khóa ngay; reconnect ⇒ join lại + refetch **một lần**; task đang mở bị người khác xóa ⇒ đóng drawer + toast; event chạm task đang mở ⇒ làm mới lịch sử. `features/realtime-session`: `member:role-changed` (quyền cập nhật tức thì), `workspace:access-revoked` (xóa cache, về `/w`).
6. **`usePermission(wsId)`** (role từ `['ws', wsId].myRole`, bảng quyền từ contracts) + policy thuần (`canDeleteTask`, `canAssignTask`). VIEWER: không tay kéo, không menu, không ô tạo, drawer chỉ đọc. Project lưu trữ: banner "Dự án đã lưu trữ — chỉ đọc", không kéo, drawer chỉ đọc.
7. **Mock API** (MSW, dùng chung test + dev): workspace, members (`q`), projects (+ archive/unarchive), toàn bộ route task + audit-logs — thứ tự lỗi như server (401 → 400 uuid → 404 → 403 → 422 → 409), state machine, anchor (`INVALID_ANCHOR`), version kiểm trước no-op (ADR-091), no-op không tăng version, ADR-041/044/045, cursor; luật quyền của mock viết **độc lập** với policy FE. Event realtime phát qua `board.onEvent` với `originClientId` lấy từ `X-Client-Id`. **Socket giả** (`test/fake-realtime.ts`): hub phát vào phòng project cho các client đã join.

## 2. Kiểm chứng
### Test (đều chạy, kiểm exit code)
- Unit: `applyRealtimeEvent` (9 ca §8.1), `computeMoveIntent`/`intentToEdge` (10), `useMoveTask` (16 — mỗi dòng bảng §4.4 + rollback có điều kiện khi event mới hơn đến giữa chừng + giữ tham chiếu task khác), rebase/`sendUpdate` (9), board-cache/transitions 4×4/policy/temp-rank (≈40), rank/date-only/LRU, adapter socket.io (8, giả lập module), `RealtimeProvider` (1), mock task API (12).
- Component (Testing Library + MSW + socket giả + axe): board (9 — 4 cột, menu chỉ cột hợp lệ + payload, tạo nhanh, realtime, reconnect refetch, join bị từ chối, VIEWER, lưu trữ realtime, hạ VIEWER realtime), drawer (10 — sửa, 409 tự rebase, khối hòa giải giữ/bỏ, picker không có VIEWER, MEMBER nhận việc, xóa, "Vẫn xóa?", bị xóa từ xa, deep-link không tồn tại).
- **Tích hợp 2 client** (`test/board-two-clients.test.tsx`): 2 cây app độc lập (QueryClient + socket giả riêng, clientId khác nhau). A "Chuyển tới Đang làm" ⇒ B thấy thẻ đổi cột; B tạo task ⇒ A thấy; **0 request tải lại board** (đếm `GET …/tasks?` bằng spy fetch, có khẳng định spy thật sự bắt được request).
- Kéo bằng chuột/bàn phím thật **không** test trong jsdom (không layout) — để E2E Playwright (E2E-02/03/04).

### Hiệu năng 500 task (`test/board-perf.test.tsx`, jsdom + React dev ⇒ cận trên)
| Đo | Kết quả |
|---|---|
| `applyRealtimeEvent` 1 event | ≈ 0.01 ms |
| `toColumns` 500 task | ≈ 0.03–0.05 ms |
| Mount 500 thẻ (React Profiler) | ≈ 610–690 ms (tới DOM ≈ 1.8 s trong jsdom) |
| Commit khi 1 event đến | ≈ 8.5–9 ms |
Phát hiện khi đo: truyền callback không ổn định xuống board (`onOpen={() => …}`) làm commit 1 event lên **≈ 223 ms** (mọi thẻ render lại) — BoardPage dùng `useCallback`; đã ghi vào frontend.md V19. Chưa đo trên Chrome thật với CPU throttle (perf Playwright §8.4 là việc E2E). Chưa cần bậc 3–4 (cột Hoàn thành 50 thẻ, ảo hóa).

### Trình duyệt thật — Lighthouse 13.5.0 (build prod `next start`, `APP_MOCK_API=1`, cổng 3001, đã đăng nhập bằng cookie refresh của người dùng seed qua mock API; ảnh chụp Lighthouse xác nhận board/drawer render đầy đủ dữ liệu)
| Trang | Accessibility | Best practices |
|---|---|---|
| Board (mobile) | **100** | 96 |
| Board + drawer `?task=` (desktop) | **100** | 96 |
Best practices chỉ trừ `inspector-issues` (CSP, không URL) — giống T-012/T-019. Ở chế độ mock dev không có Socket.io ⇒ header hiện "Mất kết nối thời gian thực" + "Tải lại bảng" (thiết kế, xem QĐ-4).

### Chưa làm được trong lượt này
- **Lượt với API thật**: T-024 chưa merge vào main lúc viết báo cáo ⇒ chưa chạy. Sẽ chạy và dán kết quả khi Tech Lead báo T-024 merge.
- Kéo thả chuột thật trên trình duyệt: công cụ điều khiển Chrome của session bị ngắt giữa chừng ⇒ chưa thao tác tay; luồng kéo đã có test logic (dnd handlers qua preview/intent) + E2E sẽ phủ.

## 3. Quyết định tự đưa ra (cần Tech Lead duyệt)
1. **Cổng token cho socket**: `session.realtimeAuth = { token, renew, onTokenRenewed, revoked }` — ngoài `http`, đây là chỗ duy nhất đọc access token (handshake + `auth:renew`); không vào React state. `tokenStore` thêm `subscribe` (listener không nhận token).
2. **Sửa trong drawer là một form + nút "Lưu thay đổi"** (không lưu từng field khi blur như wireframe) — rebase 3 chiều áp trên tập field đã đổi. Drawer mount lại form (đổi `key`) khi task đổi mà người dùng không đang sửa.
3. **Không optimistic cho sửa nội dung/gán người** (chỉ move và xóa): drawer hiện trạng thái đang lưu; giảm rủi ro rollback sai.
4. **Mock dev dùng socket offline** (phát hiện qua `API_URL` có path `/mock-api/`) thay vì thử nối Socket.io không tồn tại. Realtime dev thật cần API thật (T-024).
5. Bộ lọc board (`board-filter`) **chưa làm** — ticket không liệt kê; `computeMoveIntent` đã xử lý trường hợp "đang lọc" theo §4.3.
6. Trạng thái kết nối hiển thị ở **toolbar board** (không sửa `app-header`).
7. Mock dùng `fractional-indexing` để tính rank như server (frontend.md §2.3-5 chỉ khoanh vùng thư viện này cho `entities/task`; mock là bộ giả lập server).
8. Picker người phụ trách: `<select>` gốc, trang đầu 100 thành viên lọc role ≥ MEMBER (chưa có Combobox tìm kiếm).

## 4. Rủi ro / câu hỏi mở
1. **fractional-indexing 4.0.0 không ném lỗi khi `after ≥ before`** (trả khóa ngoài khoảng, vd `'a1V'`) — frontend.md §4.3 giả định sai; FE đã tự kiểm thứ tự (có test). Nếu server cũng dựa vào "ném lỗi" để phát hiện hàng xóm lệch thì cần A xem lại (`INVALID_ANCHOR`/retry rank).
2. Event đến trong lúc board đang tải lần đầu bị bỏ (cache chưa có); response tải về có thể cũ hơn event đó — cửa sổ nhỏ, chưa xử lý.
3. Plugin Accessibility của dnd-kit đặt `aria-roledescription` tiếng Anh nếu thiếu ⇒ handle tự đặt tiếng Việt; thẻ không kéo được không đăng ký sortable (nếu không `<article>` thành `role=button`).
4. `@dnd-kit/react` 0.x: API có thể đổi ở 0.6 — đã pin chính xác 0.5.0.

## 5. Dependency mới (`apps/web`, pin chính xác, kiểm npm registry 2026-10-15)
`@dnd-kit/react` 0.5.0 · `@dnd-kit/helpers` 0.5.0 · `@dnd-kit/dom` 0.5.0 (phát hành 2026-06-11, bản 0.x mới nhất) · `socket.io-client` (catalog 4.8.4) · `fractional-indexing` (catalog 4.0.0). Khớp frontend.md §10 V6/V9/V10. `pnpm install` trên ổ D: mất ~26 phút (registry chậm, không quá tải máy).

## 6. Cập nhật tài liệu
`docs/design/frontend.md`: §4.3 (fractional-indexing không ném lỗi) + mục mới **§10.1 V13–V19** (MSW 3 `onUnhandledFrame`/không cookie jar — theo yêu cầu Tech Lead; PointerSensor mặc định; plugin Accessibility; CollisionPriority; ResizeObserver jsdom; structural sharing; memo 500 task).

## 7. Definition of Done
Chạy trong worktree `D:/TaskFlow_wt/T-025` sau rebase lên main `f1355ce`:
```
$ pnpm typecheck              → exit 0
$ pnpm lint                   → exit 0 (prettier; eslint --max-warnings=0 gồm max-lines 150 .tsx / 200 .ts và ≤ 3 useState;
                                 depcruise web: 292 modules, 840 deps, 0 vi phạm; api: 0 vi phạm)
$ pnpm test --maxWorkers=2    → Test Files 129 passed (129) · Tests 1334 passed (1334) · exit 0, 0 "Unhandled"
$ pnpm --filter @taskflow/web build → exit 0 (route mới: /w/[wsId], /w/[wsId]/projects, /w/[wsId]/p/[projectId])
```
Build và Lighthouse chạy trên bản trước rebase (trước khi gộp T-029); phần gộp chỉ đụng mock/phiên, đã có test.
Hook pre-commit (lefthook: gitleaks + prettier + eslint) chạy đầy đủ cho mọi commit của nhánh; gitleaks `main..HEAD`: no leaks found.
