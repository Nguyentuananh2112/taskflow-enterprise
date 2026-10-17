# T-044 — Khởi động app + bundle (thẻ đầu board ≤ 500 ms @4×)

**Giao cho:** Engineer A · **Review:** Engineer E (người đề xuất) · **Nhánh:** `feat/T-044-startup-bundle` từ `main` a9a1516 ·
**Phụ thuộc:** không (S2b đổi contract ⇒ cần B nếu tới bước đó)

## Nguồn
`docs/reviews/startup-bundle-proposal.md` (E — nghi phạm S1–S8, cách đo, ngân sách) · `docs/reviews/perf-board-mount-result.md`
(phương pháp đo xen kẽ hợp lệ, sàn khởi động ≈ 0,8 s @4×) · ghi chú bổ sung của E cho TL d9 (2026-10-17): shell sau Mốc 3 có
thêm `HeaderAttendance`, `HeaderHr`, `NotificationBell` (Popover), `AttendanceCard` ⇒ request khởi động có thêm
`attendance/me/today` + `me/notifications/unread-count`.

## Mục tiêu (ngân sách — Chromium headless, CPU 4×, máy yên, trung vị ≥ 3, đo xen kẽ)
| Chỉ số | Nền (main) | Mục tiêu |
|---|---|---|
| Thẻ đầu — board 10 task | ≈ 800 ms | **≤ 500 ms** |
| Long task lớn nhất lúc khởi động | ≈ 150–160 ms | ≤ 100 ms |
| First Load JS `/login` / board (gzip) | đo ở bước 0 | chốt sau bước 0 (≈ 10–20 % dưới nền) |

## Việc cần làm (mỗi bước một commit; đo xen kẽ sau mỗi bước; chỉ leo khi chưa đạt)
0. **Đo nền** — byte First Load theo route bằng `startup.mjs bytes <dir>` (tất định, chỉ cần bản build); thời gian (việc nặng — xin lượt TL, `--rounds 5`, lượt CPU ≥ 25 % sau lượt bị loại): First Load JS theo route + phân tích chunk; thác pha (responseStart → hydrate →
   `/auth/refresh` → `/auth/me` → query đầu của route → thẻ đầu); coverage JS không chạy; long task theo chunk.
   Script đo đưa vào repo (`e2e/perf/startup.mjs`, chạy riêng, KHÔNG vào CI) — gốc là `perf-mount.mjs` của E, thêm mốc pha.
1. **S1** — `socket.io-client` nạp động (`import()`) chỉ khi phiên `authenticated`; giữ client offline cho mock API.
2. **S5** — `next/dynamic` / mount lười cho phần shell không cần ở khung hình đầu: Popover chuông, Toaster.
3. **S2a + S3** — bắt đầu khôi phục phiên sớm (không chờ effect sau hydrate); prefetch query của route theo URL song song
   với render shell. Giữ Web Locks `tf-refresh` + `sessionEnded` (security §2.5).
4. **S2b** — gộp `user` (+ memberships) vào response `/auth/refresh` ⇒ bỏ 1 round-trip. Đổi contract ⇒ cần B + SEC; chỉ
   làm nếu bước 1–3 chưa đạt và TL duyệt.
5. **S4** (zod/schema lúc nạp module) chỉ khi số đo cho thấy đáng kể. KHÔNG bỏ validate response ở prod khi chưa có số.

## Ràng buộc
- Đo bằng `next build` + server prod (standalone), mock API cùng origin (`APP_MOCK_API=1`, `APP_ENV=local`) — dev server
  không phản ánh prod.
- Hai bản build ở hai thư mục riêng (build thẳng vào chỗ, không `mv` — standalone có liên kết tuyệt đối); kiểm **dấu hiệu**
  bản build trong chunk mỗi lượt; CPU nền < 25 % trước lượt; xen kẽ A,B,B,A,A,B.
- `pnpm -r lint:deps` sạch (FSD: widget không import widget; chỉ tầng app ráp).
- Không đổi hành vi: realtime vẫn nối sau đăng nhập (kiểm `notification:new` ngay sau đăng nhập), nhiều tab / hết hạn phiên.

## Done
Thẻ đầu board 10 task ≤ 500 ms @4× (trung vị, xen kẽ với main), verify exit 0 (gồm `pnpm -r lint:deps`), E2E liên quan xanh (F), báo cáo
`docs/reviews/T-044-report.md` có bảng đo từng bước. `DONE T-044`.
