# F2 — Săn flake: E2E đa trình duyệt + integration đỏ hàng loạt (Engineer F)

**Ngày:** 2026-10-15 · **Branch:** `feat/T-026` (worktree T-017b) · **Người viết:** Engineer F (QA)

## 1. E2E luồng chính trên Firefox + mobile

- Project Playwright `firefox` (Desktop Firefox) và `mobile` (Pixel 7, Chromium) — bật bằng `E2E_FIREFOX=1` / `E2E_MOBILE=1`; local chỉ chạy luồng `@main`, CI chạy đủ.
- Luồng `@main`: đăng ký + reload, E2E-01, E2E-02 (kéo chuột), menu "Chuyển tới…", E2E-05 (realtime 2 người), E2E-10.
- **Kết quả:** chromium + firefox + mobile **18/18 xanh**, exit 0.
- Lỗi của test (đã sửa): ở 412px tâm cột "Đang làm" nằm ngoài màn hình ⇒ helper kéo giờ thả vào phần cột NHÌN THẤY (như người dùng thật).

## 2. Integration đỏ hàng loạt (~186/364) — nguyên nhân gốc

**Hiện tượng (TL báo):** lượt `test:integration` đỏ hàng loạt (40P01, P2002/P2003, rank `a0` trùng, register→login 401); chạy lại thì xanh.

**Bằng chứng (log Postgres `taskflow-postgres-test-1`, 15:50–16:10 UTC):** 45 lần `deadlock detected`, cùng một database. DETAIL của server nêu hai phía:

- `TRUNCATE task_audit_logs, tasks, … CASCADE` (reset DB ở `beforeEach`) ⇄ `UPDATE refresh_tokens SET revoked_at …` (luồng auth);
- `TRUNCATE` ⇄ `UPDATE projects SET next_task_number = …` + `SELECT tasks.rank …` + `INSERT task_audit_logs` (luồng tạo task), có cả chu trình 3 tiến trình.

⇒ Cùng lúc có test của **nhiều file khác nhau** ghi vào một DB trong khi tiến trình khác TRUNCATE ⇒ ≥ 2 tiến trình test cùng DB. Sau khi TRUNCATE bị hủy (40P01), dữ liệu bẩn ⇒ dây chuyền P2002/P2003.

**Mảnh cuối (TL + D):** 2 tiến trình đó là 2 **worker của cùng một lượt**: `VITEST_MAX_WORKERS=2` (Vitest 5 tự đọc env) **thắng `fileParallelism: false`**. 4/4 lượt có biến đó đỏ, 4/4 lượt không có xanh.

**Đã loại trừ:** maintenance scheduler (mặc định TẮT khi `APP_ENV=test`); `Promise.all` bỏ dở promise (test race dùng `settle`/`allSettled`); test timeout (log không có).

## 3. Cổng hộp đen cho fix harness (D — `fix/integration-serial`)

Script `e2e/scripts/integration-isolation-gate.mjs` — chạy `pnpm --filter @taskflow/api test:integration` thật trên DB riêng `taskflow_f2gate` + Valkey db 9, xét **exit code** + log (40P01 / P2002 / P2003 / FK):

| Chế độ | Kịch bản | Tiêu chí xanh |
|---|---|---|
| (a) | `VITEST_MAX_WORKERS=2`, 1 lượt | exit 0, không lỗi tranh chấp |
| (b) | 2 lượt song song cùng DB (lượt 2 sau 20s) | lượt 1 exit 0; lượt 2 **chờ rồi xanh** HOẶC **từ chối rõ ràng không chạy test nào** (exit ≠ 0); không lỗi tranh chấp |

**Trên main 06ed261 (trước fix) — ĐỎ đúng yêu cầu:**

| Chế độ | Exit | Kết quả |
|---|---|---|
| (a) | 1 | 158 failed / 212 passed (370), FK + 40P01 |
| (b) lượt 1 | 1 | 77 failed / 293 passed, 40P01 |
| (b) lượt 2 | 1 | 86 failed / 284 passed, FK |

Lần chạy (b) đầu tiên trùng thời điểm E chạy E2E trên Valkey db 12 ⇒ chạy lại trên db 9, kết quả đỏ tương tự (không do Valkey).

**Trên fix của D (`fix/integration-serial` @ 13e5594, snapshot riêng của F) — XANH:**

| Chế độ | Exit | Kết quả |
|---|---|---|
| (a) `VITEST_MAX_WORKERS=2` | 0 | **373/373**, không lỗi tranh chấp |
| (b) lượt 1 | 0 | **373/373** (64s) |
| (b) lượt 2 | 0 | **373/373** (102s) — log: `DB …/taskflow_f2gate / Valkey …/9 đang bận (lượt khác) — chờ tối đa 600000ms…` ⇒ chờ khóa rồi mới chạy |

Script cổng được siết sau ghi chú của D: lỗi hạ tầng (`ERR_PNPM_*`) **không** được tính là "từ chối rõ ràng"; từ chối hợp lệ phải nêu khóa.

## 4. Lỗ hổng cùng loại ở suite bảo mật (D chỉ ra)

`apps/api/test/security/vitest.config.ts` có cùng lỗ hổng ⇒ sửa (80c79e3): `delete process.env.VITEST_MAX_WORKERS` + `maxWorkers: 1`. Suite vẫn có khóa advisory theo file (T-017c), nhưng 2 worker sẽ chờ nhau tới timeout. **Chưa chạy lại với `VITEST_MAX_WORKERS=2`** (máy nhường cho lượt integration của D) — bổ sung khi chạy.

## 5. Ghi chú khác trong phiên

- `prisma-startup.int.ts` `afterAll` chỉ `kill('SIGTERM')`, không chờ process thoát ⇒ D sửa (await exit).
- Harness E2E/security: thêm listener `error` cho client pg ⇒ Postgres restart giữa chừng (57P01) không làm sập tiến trình test.

## 6. Mốc 5–6 (18/10) — E2E chập chờn khi máy tải nặng

| Ca | Biểu hiện | Nguyên nhân | Xử lý | Xác minh |
|---|---|---|---|---|
| E2E-11 (`token-expiry`) | `toHaveURL` nhận `""`; handler dialog "Chào buổi…" click "Để sau" bị *detached* tới hết giờ | Dialog nhắc chấm công thuộc `/w`; header Mốc 6 nặng hơn ⇒ `me/today` về đúng lúc ca điều hướng đi ⇒ dialog mở rồi tự unmount; handler `click()` không trần chờ nút không còn | `fixtures.ts`: handler click trần 2 s, bỏ qua nếu dialog đã tự đóng (4a803711) | E2E toàn bộ cổng Mốc 6 (TL) xanh |
| E2E-06 (`collaboration`) | chờ PATCH thành công của B hết 60 s (1 lần / lượt toàn bộ; chạy riêng luôn xanh) | B sửa mô tả trước khi NHẬN realtime "A di chuyển" ⇒ máy tải nặng thì event tới giữa lúc gõ / lưu ⇒ form rebase giữa chừng | chờ ô "Trạng thái" trong drawer của B = `IN_PROGRESS` (10 s) trước khi sửa (3fbd0acd) | `collaboration.e2e.ts` ×3 = 24/24, 0 flaky |
| E2E-HR-23 (`hr-extended`) | "Tải thêm" — đếm trước khi trang render, chờ nút đã gỡ | vòng lặp test của F (không phải request treo — F chẩn đoán sai lần đầu, E đọc trace đúng) | `support/load-more.ts loadUntilVisible` chờ số dòng tăng hoặc nút gỡ (f678b925) | E2E toàn bộ Mốc 5 107/0/0 |

**Rủi ro theo dõi (chưa khẳng định — không có trace):** E2E-06 — nếu event realtime "task đã đổi" tới ĐÚNG lúc PATCH của form đang bay, `use-edit-task-form.ts` gọi `form.reset(form.getValues())` (rebase) giữa lúc gửi ⇒ có thể có khe phía web (form sạch nhưng PATCH 409 không được gửi lại). Ca hiện chờ event trước khi sửa nên không còn chạm khe này. Nếu E2E-06 (hoặc báo lỗi người dùng "bấm Lưu mà không lưu") xuất hiện lại: giữ trace (TL đã đổi quy trình — chép `test-results` ra thư mục riêng trước khi chạy lại) và chuyển E (web T-025) xem.
