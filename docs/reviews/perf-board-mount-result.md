# perf/board-mount — kết quả đo cuối (bậc 1: menu "⋯" mount lười)

Engineer E · 2026-10-16 · đề xuất và các lượt đo trước: `perf-board-mount-proposal.md`. **Tech Lead chốt: MERGE bậc 1.**

## Cách đo (lượt hợp lệ, 21:15–21:18)
- Hai bản build `next build` (output standalone) ở **hai thư mục riêng**, không đổi chỗ giữa các lượt: **main `618bb41`** trong một worktree tách riêng (ổ C:), **HEAD `7468bbc`** (bậc 1) tại worktree T-025.
- Mỗi lượt: khởi động `server.js` của đúng thư mục trên cổng 3021 (mock API), đo, tắt và chờ tiến trình thoát hẳn.
- **Trước mỗi lượt kiểm dấu hiệu** trên bản đang phục vụ: số chunk chứa `new Set(["Enter"," ","ArrowDown"])` — mã chỉ có trong menu lười (main = 0, HEAD = 1); sai ⇒ dừng toàn bộ. Dấu hiệu và CPU nền ghi vào từng dòng; CPU > 25 % ⇒ chờ 20 s, đo lại.
- Chromium headless (Playwright), CPU throttle 4× (CDP), 1440×900, 1 cột; mỗi lượt đo board **10 task** (sàn khởi động) và **500 task**. 3 vòng xen kẽ: main→head, head→main, main→head.
- Số: thời điểm thẻ đầu hiện (ms từ điều hướng), long task lớn nhất, `ScriptDuration` của CDP `Performance.getMetrics`.

## 12 lượt
| Vòng | Bản | Dấu hiệu | Task | CPU trước | Thẻ đầu | Long task max | Script |
|---|---|---|---|---|---|---|---|
| 1 | main | 0 | 10 | 16 % | 994 | 164 | 256 |
| 1 | main | 0 | 500 | 14 % | 2228 | 1532 | 1691 |
| 1 | head | 1 | 10 | 14 % | 767 | 152 | 210 |
| 1 | head | 1 | 500 | 13 % | 1983 | 1288 | 1439 |
| 2 | head | 1 | 10 | 16 % | 786 | 155 | 228 |
| 2 | head | 1 | 500 | 13 % | 1970 | 1249 | 1423 |
| 2 | main | 0 | 10 | 15 % | 834 | 154 | 262 |
| 2 | main | 0 | 500 | 14 % | 2649 | 1781 | 1981 |
| 3 | main | 0 | 10 | 18 % | 853 | 163 | 252 |
| 3 | main | 0 | 500 | 16 % | 2325 | 1537 | 1699 |
| 3 | head | 1 | 10 | 14 % | 781 | 148 | 219 |
| 3 | head | 1 | 500 | 16 % | 1932 | 1209 | 1374 |

**Trung vị:**

| | Thẻ đầu | Long task max | Script |
|---|---|---|---|
| 10 task — main / head | 853 / 781 | 163 / 152 | 256 / 219 |
| 500 task — main / head | 2325 / **1970 (−15 %)** | 1537 / **1249 (−19 %)** | 1699 / **1423 (−16 %)** |

HEAD tốt hơn main ở **cả 3 vòng, cả 3 chỉ số** (500 task).

## Kết luận
1. **Bậc 1 có lợi thật, ~15–19 %** với board 500 thẻ, không đổi UX/a11y ⇒ merge.
2. **Sàn khởi động ≈ 0,8 s @4×** (10 task, cả hai bản): ngân sách "thẻ đầu < 300 ms @4×" (frontend.md §4.7) không đạt được bằng tối ưu board — thuộc **ticket startup/bundle riêng sau Mốc 1** (tải/parse/hydrate JS, khôi phục phiên).
3. Sau bậc 1, 500 thẻ vẫn tốn thêm ~1,2 s @4× so với sàn — chính là chi phí render thẻ (TaskCard + `useSortable`). Đòn bẩy lớn còn lại là ảo hóa cột, đã bác vì kéo bằng bàn phím của dnd-kit và Ctrl+F / trình đọc màn hình (đề xuất, mục A/B).

## Vì sao số −47 % trước đây sai
Lượt "bậc 0 → bậc 1" ghi trong `perf-board-mount-proposal.md` (Script 2781 → 1487) đo **tuần tự, ở hai thời điểm khác nhau**, baseline là bản build cũ của nhánh perf/board-500 chạy bằng `next start` trên cấu hình standalone (Next cảnh báo không hỗ trợ), bậc 1 là bản build khác chạy lúc khác. Không xen kẽ, không đối chứng cùng điều kiện. Số bậc 1 cũ (1487) gần với số HEAD mới (1423), còn baseline cũ (2781) cao hơn nhiều so với main đo xen kẽ (~1700) dù khác biệt code giữa hai bản chỉ là menu lười ⇒ sai lệch nằm ở lượt baseline. Nguyên nhân cụ thể (tải máy lúc đó, trạng thái cache, cách chạy server) **chưa xác định** — không đo lại được lượt cũ. Bài học: so sánh hiệu năng chỉ tin khi **xen kẽ, cùng cách chạy server, cùng lượt máy**.

## Sự cố trong lúc đo (đã loại bỏ số)
- Lượt 1: dời thư mục `.next` ra chỗ khác ⇒ `.next/standalone` (pnpm) chứa liên kết trỏ **tuyệt đối** về vị trí build ⇒ server không lên, mọi lượt lỗi. Bỏ.
- Lượt 2: đổi tên bản build qua lại về đúng chỗ gốc mỗi lượt ⇒ có lần `mv` thất bại (Windows còn khóa file khi server chưa thoát hẳn), bản HEAD bị **lồng** vào `.next/head` của bản main ⇒ nhãn các lượt sau bị lẫn ("head" thực ra chạy main) — ra kết quả sai "main ≈ head". Phát hiện lúc dọn, xác minh bằng dấu hiệu trên, **đính chính ngay với Tech Lead trước khi viết báo cáo**; số bỏ.
- Lượt hợp lệ (bảng trên) dùng 2 thư mục riêng + kiểm dấu hiệu từng lượt — cách đo nên dùng lại cho các lần so sánh sau.
