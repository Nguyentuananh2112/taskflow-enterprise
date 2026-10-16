# F5: cổng cho process/container test, bỏ dải ephemeral (Engineer F)

**Branch:** `fix/F5-ports` từ main 3b16a6e · **Ngày:** 2026-10-16 · **Tech Lead duyệt phương án:** 2026-10-16

## Vấn đề

Lượt `test:security` ngày 2026-10-16 (sec-unpend) đỏ sau 11 s mà không chạy ca nào. Log: `EADDRINUSE: address already in use :::51644` ở bước warm-up process API. `netstat` cho thấy cổng 51644 đang là **cổng nguồn của một kết nối HTTPS đi ra** (PID khác, trình duyệt).

**Nguyên nhân gốc:** `freePort()` của harness bảo mật làm `listen(0)` trên `127.0.0.1`, đóng lại, rồi giao số cổng cho API. Có hai chỗ sai:
1. `listen(0)` luôn trả cổng trong **dải ephemeral** (Windows 49152–65535; Linux mặc định 32768–60999). Đây cũng là dải hệ điều hành cấp cho kết nối **đi ra**, nên giữa lúc "chọn" và lúc API listen, bất kỳ kết nối ra ngoài nào cũng có thể chiếm đúng cổng đó.
2. Hàm chỉ thử trên `127.0.0.1`, trong khi API listen trên `::`. Vì vậy một socket IPv6 đang dùng cổng đó sẽ không bị phát hiện.

Hai file startup integration (`prisma-startup`, `task-prisma-startup`) dùng `4600/4900 + random` và **không kiểm trống**.

## Thay đổi (chỉ `apps/api/test/**`)

| File | Nội dung |
|---|---|
| `test/support/ports.ts` *(mới)* | `availablePort()`: chọn ngẫu nhiên trong **20000–29999**, nằm ngoài dải ephemeral của cả Windows lẫn Linux. Bind thử `exclusive` trên **cả `::` và `127.0.0.1`** (máy không có IPv6 thì bỏ qua `::`), tối đa 50 lần; hết lượt thì báo lỗi nêu dải và các cổng đã thử |
| `test/support/ports.test.ts` *(mới)* | Cổng nằm trong dải và dưới 32768; cổng đang bị chiếm thì bị bỏ qua và lấy số kế; hết lượt thì báo lỗi đúng thông điệp |
| `test/security/harness/api-process.ts` | `freePort()` chuyển sang `availablePort()`. Áp cho process API **và** container Valkey tạm (`valkey-container.ts` gọi `freePort`) |
| `test/integration/startup/prisma-startup.int.ts` | `PORT` và `PORT_GUARD` lấy từ `availablePort()` (thay `PORT + 1`) |
| `test/integration/startup/task-prisma-startup.int.ts` | `PORT` lấy từ `availablePort()` |

E2E giữ cổng cố định 3100/4100: web cần biết trước origin cho `CORS_ORIGINS`, và hai cổng này nằm ngoài dải ephemeral.

**Không làm "API listen cổng 0".** Harness spawn `src/main.ts` thật, mà `env.ts` đặt `PORT` `min(1)` và log `api.listening` in `env.PORT` thay vì cổng thật. Làm vậy phải sửa code sản phẩm, ngoài phạm vi F; TL quyết không cần ticket lúc này.

**Khe còn lại (chấp nhận):** vẫn có một khoảng nhỏ giữa lúc chọn cổng và lúc listen. Trong dải 20000–29999, chỉ một listener khác chủ động chọn cùng dải mới có thể chiếm, tức một lượt test khác, và các lượt này đã có khóa run theo DB/Valkey. Khe này không còn va với kết nối đi ra.

## Kết quả (snapshot 3dbc24e)

| Kiểm | Kết quả |
|---|---|
| `pnpm --filter @taskflow/api typecheck` · eslint (file đổi) · hook commit | exit 0 · 0 · xanh |
| `vitest run test/support/ports.test.ts` ×3 | exit 0 ×3, 3/3 |
| Mutant tay: bỏ kiểm `canBind` (luôn trả cổng) | **exit 1**, 2 test đỏ (cổng bị chiếm, hết lượt), đã khôi phục |
| `test:security` mặc định | exit 0. Main 3b16a6e chưa có sec-unpend nên vẫn 45 passed / 44 skipped / 36 todo, giống main |
| `SEC_RUN_PENDING=all test:security` (mọi file khởi động API, gồm container Valkey tạm) | **exit 0: 10 file, 89 passed / 36 todo**, 144 s, không EADDRINUSE |
| `test:integration` (DB mới `taskflow_f5`, Valkey db 8, `REQUIRE_INTEGRATION=1`, không `VITEST_MAX_WORKERS`) | **exit 0: 44/44 file (gồm `prisma-startup` và `task-prisma-startup`), 385/385**, 96 s |
