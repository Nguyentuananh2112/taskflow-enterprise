# Web test chập chờn khi máy bận — báo cáo sửa (Engineer E, 2026-10-15)

**Branch:** `fix/web-test-timeouts` (từ main) · Yêu cầu: tin nhắn Tech Lead (A, B thấy root `pnpm test` đỏ ở apps/web: timeout 5000ms + "Worker forks emitted error"; chạy riêng thì xanh).

## Đã làm
1. **`apps/web/vitest.config.ts`: `testTimeout` / `hookTimeout` = 15s.** jsdom + react-hook-form + axe chậm nhiều lần khi máy bận. Không che lỗi chức năng: mọi assert giữ nguyên, test treo thật vẫn đỏ.
2. **Bỏ nhịp chờ thừa của user-event:** `userEvent.setup()` ⇒ `userEvent.setup({ delay: null })` ở 7 file test. Vẫn phát đủ keydown/input/keyup cho TỪNG ký tự (RHF vẫn validate như thật), chỉ bỏ `setTimeout` giữa các phím — mật khẩu 12–25 ký tự trước đây tốn 12–25 vòng timer mỗi ô.
3. **Test đếm render board:** 60 ⇒ 24 thẻ (khẳng định tất định không đổi: 1 event ⇒ đúng 1 thẻ render lại; ca đối chứng ⇒ mọi thẻ). Các test board/drawer khác dựng cả cây app là có chủ đích (tích hợp), không đổi.
4. **Kiểm lại guard T-022:** thêm TẠM một test tự `SIGKILL` worker ⇒ Vitest in `Test Files 3 passed (4)` nhưng có `Unhandled Error: Worker forks emitted error` và **exit 1**. Guard còn hiệu lực; file tạm đã xóa.

## Số đo (project `web`, `--maxWorkers=2`, máy dev đang chạy các phiên khác)
| | Trước | Sau |
|---|---|---|
| Tổng thời gian các file test | 27.8 s | 18.2 s (−35%) |
| Test lâu nhất | 1 986 ms (`auth-flow` luồng chính) | 1 298 ms |
| `register-form.test.tsx` | 3.7 s | 1.6 s |
| `auth-flow.test.tsx` | 3.5 s | 1.8 s |
| `login-form.test.tsx` | 2.9 s | 1.5 s |
| `change-password-form.test.tsx` | 2.6 s | 0.7 s |
| `task-drawer.test.tsx` | 3.6 s | 2.8 s |
| `board-flow.test.tsx` | 3.8 s | 2.7 s |
| Kết quả | 353/353 | 353/353 |

**Tải nặng (mô phỏng máy bận):** `vitest run --project web --maxWorkers=8` hai lượt liên tiếp: 43 file / 353 test xanh, exit 0 (19.4 s và 39.0 s — lượt 2 chậm gấp đôi do tranh tài nguyên, không timeout).
