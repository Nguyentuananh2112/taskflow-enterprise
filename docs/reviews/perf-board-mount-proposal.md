# perf/board-mount — đề xuất giảm thời gian mount board 500 thẻ (CHƯA code)

Engineer E · 2026-10-16 · branch `perf/board-mount` (từ `perf/board-500` @4991791) · chờ Tech Lead duyệt.

## Vấn đề (số đã đo, `perf-board-500-report.md`)
Chromium headless, bản prod, 1 cột × 500 thẻ: CPU 1× mount 994 ms (long task lớn nhất 314 ms); **CPU 4× mount 3760 ms, long task 2423 ms**. Ngân sách frontend.md §4.7: board 500 task render lần đầu < 300 ms ở CPU 4×. jsdom (không layout): mount 482–489 ms (1×500), 987–1367 ms (4×500) ⇒ phần JS/React đã lớn, chưa biết layout/paint chiếm bao nhiêu.

## Mỗi thẻ đang mount những gì (đọc code)
`SortableTaskCard` → `useSortable` (đăng ký draggable + droppable với dnd-kit) → `TaskCard` (`article`, nút tiêu đề, `PriorityBadge`, `DueDate`, `Avatar`) + nút kéo + **`MoveMenu` = một `DropdownMenu` Radix đầy đủ cho MỖI thẻ** (`Menu.Root` + `Trigger` + `Portal` — nhiều context provider, Popper anchor, collection, `useId`; nội dung chỉ mount khi mở). 500 thẻ ⇒ 500 Root Radix + 500 đăng ký dnd-kit dù người dùng chỉ mở một menu.

## Phương án đã cân nhắc

| | Ý tưởng | Lợi | Hại |
|---|---|---|---|
| A | "Hiện thêm": mỗi cột render K thẻ đầu (vd 50) + nút "Hiện thêm (còn N)" | Đơn giản, DOM còn lại là thật | Thẻ ẩn không kéo/tìm (Ctrl+F)/đọc được tới khi bấm; cột nào cũng có thể 500 (đo 1×500 là cột Cần làm, không chỉ Hoàn thành) ⇒ phải áp mọi cột; thay đổi UX |
| B | Ảo hóa cột (`@tanstack/react-virtual`) khi > 150 thẻ | Mount ~20 thẻ/cột bất kể N | Xung đột dnd-kit sortable (thẻ chưa mount không có droppable ⇒ kéo/bàn phím không tới được vị trí ngoài màn; auto-scroll khi kéo phải tự viết); trình đọc màn hình mất ngữ cảnh danh sách (phải tự `aria-setsize/posinset`); Ctrl+F mất; chiều cao thẻ thay đổi (tiêu đề xuống dòng) ⇒ phải đo; +3 ngày (§4.7) |
| C | Giảm chi phí MỖI thẻ: `MoveMenu` mount Radix lười (chỉ khi người dùng tương tác) | Không đổi UX/a11y; lợi cho mọi kích thước board | Phải giữ y hệt hành vi phím của Radix ở lần mở đầu |
| D | Mount dần (time-slicing): render ngay K thẻ đầu mỗi cột, phần còn lại thêm theo lô trong `startTransition` (React 19 nhường main thread ~5 ms) | Không còn một long task 2,4 s; cuối cùng DOM đầy đủ ⇒ a11y, Ctrl+F, kéo-thả như cũ | Có vài trăm ms board "đang hoàn tất"; phải khóa kéo/thả vào cột chưa mount xong; tổng công không giảm |
| E | CSS `content-visibility: auto` + `contain-intrinsic-size` cho thẻ | Trình duyệt bỏ layout/paint thẻ ngoài màn; DOM vẫn đủ (a11y, Ctrl+F, dnd giữ nguyên); 2 dòng CSS | Chỉ cắt phần layout/paint, không cắt JS; thanh cuộn ước lượng; cần kiểm dnd-kit đo kích thước thẻ ngoài màn khi kéo |

## Đề xuất (theo thứ tự, mỗi bậc đo lại, chỉ leo khi chưa đạt)
0. **Đo phân rã trước** (lượt máy ~5 phút): trace Chromium (CDP Tracing) lúc mount 1×500 ở 4× ⇒ tách scripting vs style/layout/paint; React Profiler theo component (TaskCard / MoveMenu / useSortable). Quyết định C/D/E dựa trên số này, không đoán.
1. **C — `MoveMenu` lười**: ban đầu chỉ là `<button aria-label="Thao tác với KEY" aria-haspopup="menu">⋯</button>` (cùng tên truy cập, cùng vị trí tab); `pointerdown` / Enter / Space / ArrowDown ⇒ mount `DropdownMenu` Radix với `defaultOpen` và focus vào mục đầu (như Radix khi mở bằng phím). Kỳ vọng: cắt phần lớn chi phí JS mỗi thẻ (ước, sẽ đo ở bậc 0).
2. **E — `content-visibility: auto`** trên `<li>` thẻ (nếu bậc 0 cho thấy layout/paint đáng kể).
3. **D — mount dần** nếu sau 1–2 vẫn còn long task > 200 ms ở 4×: K = 40 thẻ/cột ngay, +100/lô trong `startTransition`; trong lúc chưa đủ: `aria-busy="true"` trên cột + chữ "Đang tải thêm thẻ…" (role=status), kéo-thả bị khóa (nút kéo `disabled`, menu "Chuyển tới" vẫn dùng được vì gọi server theo intent).
4. **Không làm A, B** ở v1 (lý do ở bảng). Chỉ xét lại B nếu cột thực tế vượt ~1000 thẻ (khi đó rebalance cũng đã bị bỏ qua — `RANK_REBALANCE_MAX_TASKS = 500`).

## Tiêu chí nghiệm thu (đo trước/sau cùng script, cùng máy yên)
- Chromium 4×, 1×500: **không long task > 200 ms** trong lúc mount; thẻ đầu tiên hiển thị < 300 ms sau khi có dữ liệu (ngân sách §4.7 hiểu là "render đầu", ghi rõ trong báo cáo); tổng thời gian tới đủ 500 thẻ không tệ hơn hiện tại.
- Không hồi quy: 1 `task:moved` vẫn < 50 ms (bench jsdom), render-count tests, `board-flow`, `board-two-clients`, axe.
- F: E2E kéo-thả chuột + bàn phím (E2E-03, cột rỗng) + "Chuyển tới" + realtime 2 client.

## Phản biện 4 vòng (tự phản biện, để Tech Lead soi)
1. **A11y / bàn phím.** C: nút giả phải có đúng `aria-haspopup`, `aria-expanded=false`, tên truy cập như cũ; mở bằng Enter/Space/ArrowDown phải đưa focus vào mục đầu ⇒ test component cho cả 3 phím + Esc trả focus về nút (giống Radix). D: thẻ chưa mount không tab tới được ⇒ chỉ chấp nhận vì tạm thời (< 1 s) và có `aria-busy`; không chấp nhận "Hiện thêm" vĩnh viễn (A) vì thẻ bị giấu thật. B bị loại chính vì vòng này (kéo bằng bàn phím của dnd-kit đi theo droppable đã đăng ký — thẻ ngoài màn không tồn tại).
2. **Kéo-thả + realtime.** C không đụng `useSortable`. E: dnd-kit đo `getBoundingClientRect` lúc kéo — với `content-visibility:auto` phần tử ngoài màn vẫn có hộp ước lượng (`contain-intrinsic-size`) ⇒ phải kiểm thả vào giữa cột dài sau khi cuộn (E2E). D: event realtime đến khi cột chưa mount đủ vẫn ghi cache bình thường (P1); chỉ phần hiển thị trễ — không mất dữ liệu.
3. **Đo có đáng tin?** jsdom không có layout ⇒ không dùng jsdom để kết luận E. Đo trên Chromium, CPU 4× bằng CDP, máy yên (xin lượt), 3 lần lấy trung vị; script giữ trong repo (`perf/`) thay vì scratchpad để F/Tech Lead chạy lại được — nhưng chạy RIÊNG, không vào CI (ngưỡng ms phụ thuộc máy).
4. **Chi phí / bảo trì / rút lui.** C ~0.5 ngày (+ test phím), E ~0.25 ngày, D ~1 ngày; mỗi bậc là commit riêng, revert độc lập. Rủi ro lớn nhất là C lệch hành vi Radix ở bản nâng cấp sau ⇒ bọc trong `shared/ui/dropdown-menu` (một chỗ), không rải ở feature.

## Cần Tech Lead quyết
- Duyệt thứ tự 0 → 1 → (2) → (3); và cách hiểu ngân sách "render đầu < 300 ms ở 4×" = thẻ đầu tiên hiện, không phải đủ 500 thẻ.
- Lượt máy ~5 phút cho bậc 0 (Chromium trace).
