# Startup / bundle — đề xuất vé sau Mốc 1 (CHƯA làm, chỉ đọc code)

Engineer E · 2026-10-16 · nguồn số: `perf-board-mount-result.md` (đo xen kẽ hợp lệ).

## Vấn đề
Board **10 task** (gần như không có board) vẫn mất **~0,8 s tới thẻ đầu** ở Chromium CPU 4× (main 853 ms / bậc 1 781 ms; long task ~150–160 ms, Script ~220–260 ms). Ngân sách frontend.md §4.7 "render đầu < 300 ms @4×" vì vậy không đạt được bằng tối ưu board — phần còn lại là **khởi động app**. Vé này tìm và cắt phần đó.

## Đường khởi động hiện tại (đọc code)
1. Tải + parse + chạy JS chung của layout gốc (`app/layout.tsx` → `AppProviders`), hydrate.
2. `AuthGate` (client) chỉ bắt đầu khôi phục phiên **sau hydrate** (`useEffect` → `session.bootstrap()`): `/auth/refresh` (qua Web Locks `tf-refresh`) **rồi** `/auth/me` — nối đuôi.
3. Chỉ khi `authenticated` mới render route ⇒ route mới gửi query của nó (workspace + project + board chạy song song) ⇒ render thẻ.

⇒ Ít nhất **3 pha nối đuôi**: JS/hydrate → refresh → me → query của route. Ở CPU 4× mỗi pha còn cộng thời gian chạy JS.

## Nghi phạm (theo import graph — CẦN đo để xếp hạng, chưa khẳng định)
| # | Nghi phạm | Bằng chứng trong code | Hướng xử lý |
|---|---|---|---|
| S1 | **socket.io-client** nạp ở MỌI route (cả /login, landing) | `app/providers/realtime-provider.tsx` import tĩnh `createSocketIoClient` từ `shared/socket` (nơi duy nhất import `socket.io-client`) | `import()` động khi phiên `authenticated` (client offline đã có sẵn: `createOfflineRealtimeClient`) |
| S2 | **Chuỗi refresh → me nối đuôi** sau hydrate | `AuthGate` + `session.bootstrap()` | (a) bắt đầu refresh sớm hơn (module-level ngay khi bundle chạy, không chờ effect); (b) cân nhắc API trả `user` + memberships kèm response refresh (đổi contract — cần B) ⇒ bỏ 1 round-trip |
| S3 | **Query của route chỉ bắt đầu sau auth** | route render sau `authenticated` | prefetch query của route (theo URL) ngay khi có token, song song với render shell |
| S4 | **zod + schema contracts dựng lúc nạp module** | entity/api import schema từ contracts (subpath); `applyVietnameseZodLocale` ở `AppProviders`; `zod-jitless` | đo chi phí eval; nếu đáng kể: chỉ parse response ở dev/test (prod tin phong bì? — **không** khuyến nghị bỏ validate trước khi đo), hoặc tách locale ra chunk khi cần form |
| S5 | **Toaster, Radix (Dialog/Popover/Dropdown), header (chuông, chấm công)** nạp ở shell | `AppProviders` có `Toaster`; `AppHeader` có `NotificationBell` (Popover) + `HeaderAttendance` | `next/dynamic` cho phần không cần ở khung hình đầu (Popover chỉ khi mở; Toaster sau idle) |
| S6 | Thư viện chỉ của board (dnd-kit, react-hook-form) có lọt vào chunk chung không | — | kiểm bằng phân tích bundle; nếu lọt: tách theo route |
| S7 | Sentry | `instrumentation-client.ts` đã `import()` động khi có DSN | giữ — kiểm lại chunk không nằm trong First Load |
| S8 | Font Inter tự host (`@font-face`) | `globals.css` | kiểm `font-display: swap` + preload đúng subset; không chặn render |

## Cách đo (trước khi sửa, lặp lại sau mỗi bước — cùng phương pháp xen kẽ đã dùng)
1. **Kích thước:** bảng "First Load JS" của `next build` theo route (`/login`, `/w`, `/w/:ws/projects`, board) + phân tích chunk (Turbopack — xem tùy chọn analyze của Next 16; nếu không có thì `source-map-explorer` trên chunk prod) ⇒ biết thư viện nào nằm trong chunk chung.
2. **Thời gian theo pha** (Chromium headless, CPU 4×, 10 task, trung vị ≥ 3 lần, xen kẽ trước/sau, kiểm dấu hiệu bản build mỗi lượt): mốc `responseStart`, kết thúc hydrate (React `onRecoverableError`/mark tự đặt), thời điểm gửi/nhận `/auth/refresh`, `/auth/me`, query đầu của route, thẻ đầu (MutationObserver). Ra một "thác" pha nào chiếm bao nhiêu.
3. **JS không dùng ở route đầu:** CDP `Profiler.startPreciseCoverage` lúc vào `/login` và board ⇒ % byte không chạy theo chunk.
4. **Long task theo nguồn:** CDP Tracing (`devtools.timeline`) để biết long task ~150 ms thuộc chunk nào (eval vs hydrate).

## Ngân sách đề xuất (thay §4.7 "render đầu < 300 ms @4×", vốn không phân biệt khởi động và board)
| Chỉ số (Chromium, CPU 4×, máy yên, trung vị) | Hiện tại | Đề xuất |
|---|---|---|
| First Load JS route `/login` (gzip) | đo ở bước 1 | ≤ 150 KB |
| First Load JS board (gzip) | đo ở bước 1 | ≤ 250 KB |
| Thẻ đầu — board 10 task | ~800 ms | **≤ 500 ms** |
| Long task lớn nhất lúc khởi động | ~155 ms | ≤ 100 ms |
| Thẻ đầu — board 500 task | ~1970 ms | ≤ 1500 ms (phần board: xem perf-board-mount) |
Số KB chốt sau khi đo bước 1 (đặt ~10–20 % dưới mức hiện tại để có mục tiêu thật).

## Thứ tự đề xuất (mỗi bước một commit, đo xen kẽ, chỉ leo khi chưa đạt)
1. Đo (bước 1–4) ⇒ xếp hạng S1–S8 bằng số.
2. S1 (socket động) + S5 (dynamic cho Popover/Toaster) — rủi ro thấp, không đổi hành vi.
3. S2a + S3 (bắt đầu refresh sớm, prefetch query theo URL) — đổi thứ tự khởi động, cần test kỹ phiên/hết hạn/nhiều tab (Web Locks).
4. S2b (gộp user vào response refresh) — đổi contract, cần B + SEC.
5. S4 chỉ khi số đo cho thấy đáng kể.

## Rủi ro
- Tải động socket ⇒ sự kiện realtime đầu tiên trễ hơn vài chục ms sau đăng nhập (chấp nhận được; reconnect đã refetch).
- Bắt đầu refresh trước hydrate phải giữ đúng Web Locks + `sessionEnded` hiện có (security §2.5).
- Không bỏ validate response ở prod nếu chưa đo (an toàn kiểu dữ liệu quan trọng hơn vài ms).
