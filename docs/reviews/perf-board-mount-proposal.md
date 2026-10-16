# perf/board-mount — đề xuất giảm thời gian mount board 500 thẻ (CHƯA code)


> **ĐÍNH CHÍNH (2026-10-16, sau đo xen kẽ):** các số "bậc 1: −47 % script, −49 % long task" ở dưới là từ lượt đo tuần tự, không đối chứng — **không dùng**. Số hợp lệ (xen kẽ main vs HEAD, kiểm dấu hiệu từng lượt): bậc 1 giảm ~15–19 % với 500 thẻ; sàn khởi động ≈ 0,8 s @4×. Xem `perf-board-mount-result.md`. Tech Lead chốt merge bậc 1.

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

## Bậc 0 — baseline đo (2026-10-16, bản build perf/board-500 `bfb6706`, Chromium 4×, 1×500, trung vị 3 lần)
| Thẻ đầu hiện | Đủ 500 thẻ | Long task max / tổng | Script | RecalcStyle | Layout | Task |
|---|---|---|---|---|---|---|
| 3468 ms | 3468 ms | 2573 / 3484 ms | **2781 ms** | 84 ms | 348 ms | 3998 ms |

⇒ JS chiếm ~70 % thời gian task, style + layout ~11 % ⇒ **bậc 2 (`content-visibility`) lợi ít, bỏ qua trừ khi sau bậc 1 layout thành phần lớn**. Cả cột hiện một lần (thẻ đầu = đủ 500) ⇒ nếu bậc 1 chưa đủ, bậc 3 (mount dần) là bậc kế.

Bậc 1 (MoveMenu lười) đã code + test (`shared/ui/dropdown-menu`, 5 ca phím/chuột/axe; board-flow, board-two-clients, render-count xanh). Lượt đo sau bậc 1 bị dừng: build treo > 10 phút vì máy chịu tải ngoài dự án (một ứng dụng ~7,5 GB RAM) ⇒ không lấy số, chờ lượt máy mới. Một lần chạy test trước đó cũng treo (cùng lúc với lỗi kiểu `onOpenAutoFocus` không có trên `DropdownMenu.Content` — đã sửa bằng effect focus mục đầu); chạy lại từng file có timeout: không tái hiện.

## Đo bậc 1 và bậc 3 (2026-10-16 17:55–18:02, CPU nền 16 %, RAM trống 11 GB; Chromium 4×, 1×500, trung vị 3 lần; mỗi bản `next build` riêng)

| Bản | Thẻ đầu | Đủ 500 | Long task max / tổng | Script | Layout | Style | Task |
|---|---|---|---|---|---|---|---|
| Bậc 0 baseline (`bfb6706`) | 3468 | 3468 | 2573 / 3484 | 2781 | 348 | 84 | 3998 |
| Bậc 1 MoveMenu lười (`1988932`) | **2107** | 2107 | **1303** / 2022 | **1487** | 275 | 73 | 2504 |
| Bậc 1 + 3 mount dần (`b2b3bfd`) | **868** | 2407 | 1258 / 2589 | 2666 | 259 | 75 | 3747 |

jsdom (`test:perf`, trên `b2b3bfd`): 1 `task:moved` commit **31 / 46 ms** (1×500 / 4×500) — không hồi quy (< 50); rebalance không gom: commit max 93 / 165 ms (< 200); qua sink, event dồn: 1 commit 39 / 27 ms. (Số "mount" của jsdom giờ chỉ là lô đầu 40 thẻ/cột.)

**Đọc số (trung thực):**
- **Bậc 1 thắng rõ:** Script −47 % (2781 → 1487), long task max −49 % (2573 → 1303), thẻ đầu −39 %. Không đổi UX.
- **Bậc 3 lẫn lộn:** thẻ đầu nhanh hơn nữa (2107 → 868) nhưng long task max **không giảm** (1303 → 1258), tổng Script TĂNG (1487 → 2666) và đủ 500 thẻ chậm hơn (2107 → 2407): mỗi lô render lại `KanbanBoard`/cột, và lúc chốt `dragLocked` đổi ⇒ 500 wrapper render lại.
- **Chưa đạt tiêu chí** (thẻ đầu < 300 ms, không long task > 200 ms @4×). Còn một long task ~1,25 s mà bậc 3 không chia nhỏ được ⇒ nghi là phần KHỞI ĐỘNG APP (tải/parse/hydrate JS, khôi phục phiên, query) chứ không phải render board — chưa có số đối chứng để khẳng định.

**Đề xuất tiếp (chưa làm, chờ Tech Lead):**
1. Đo ĐỐI CHỨNG ~3 phút: cùng bản build, board **10 task** ⇒ "sàn khởi động" (thẻ đầu, long task max). Nếu sàn ≈ 800–1200 ms thì ngân sách < 300 ms @4× không đạt được bằng việc tối ưu board; phần còn lại là bundle/khởi động (ticket khác: tách chunk, hoãn Sentry/socket…).
2. **Giữ bậc 1.** Bậc 3: hoặc bỏ (revert `b2b3bfd`), hoặc giữ nếu Tech Lead coi "thẻ đầu sớm" quan trọng hơn tổng thời gian; nếu giữ, sửa chi phí lô (memo phần `KanbanBoard` ngoài cột, tránh flip `dragLocked` render lại cả cột) rồi đo lại. Mình nghiêng về **bỏ bậc 3** cho tới khi có số đối chứng.

## Kết luận (Tech Lead quyết, 2026-10-16)
- **Giữ bậc 1** (`1988932`): −47 % script, −49 % long task, thẻ đầu −39 %, không đổi UX/a11y.
- **Bỏ bậc 3**: revert bằng commit revert `4f00c27` (không viết lại lịch sử) — tổng JS tăng, long task không giảm, thêm phức tạp (khóa kéo, `aria-busy`) mà không đạt mục tiêu. Code `apps/` sau revert trùng hệt `1988932` (đã test: menu 5, board-flow 9, two-clients 1, render-count 4).
- **Bậc 2 bỏ** (layout chỉ ~9 % task).
- **Còn lại:** lượt đối chứng "sàn khởi động" (board 10 task, cùng build, ~3 phút) sau k6 của D. Nếu sàn ≈ 1 s ⇒ tiêu chí < 300 ms @4× thuộc ticket khởi động/bundle riêng (sau Mốc 1), board coi như xong. Sau đó F chạy E2E (kéo-thả, Chuyển tới, realtime, axe), Tech Lead verify + merge.
