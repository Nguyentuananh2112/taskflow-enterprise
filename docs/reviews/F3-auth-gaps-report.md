# F3 auth — lấp GAP P2 từ mutation (chủ module: B)

**Người làm:** Engineer B · **Branch:** `test/F3-auth-gaps` (từ main `68e8e31`) · **Ngày:** 2026-10-16
**Nguồn:** F3 mutation report của F (`feat/F3`, `docs/reviews/F3-mutation-report.md` §3), snapshot main `d647383`.

Chỉ thêm test, không đổi code sản phẩm.

| GAP | Vị trí | Test mới |
|---|---|---|
| B-2 | `logout-all.use-case.ts:35` | `bumpTokenVersion` trả null (user bị xóa giữa lúc đọc và ghi) ⇒ 401 + rollback: không ghi tv vào Valkey, không thu hồi token, không ngắt socket, không event |
| B-3 | `change-password.use-case.ts:82` | User bị xóa mềm SAU verify + băm (ngoài tx), lần đọc lại trong tx thấy `deletedAt` ⇒ 401; hash / tv / token / Valkey không đổi |
| B-4 | `update-me.use-case.ts:21-22` | `updateProfile` trả false ⇒ 401, họ tên không đổi |
| B-5 | `auth.controller.ts:125` | HTTP logout-all ⇒ `Set-Cookie: tf_rt=; … Max-Age=0` |
| B-6 | `auth.routes.ts:62` | HTTP change-password có field lạ (`tokenVersion`) ⇒ 400 `VALIDATION_ERROR`; use case không chạy (token cũ vẫn 200). Chọn field lạ chứ không phải thiếu field: thiếu `newPassword` thì use case cũng tự ném 400 ⇒ không giết được mutant "bỏ validate" |
| B-7 | `auth.controller.ts:104-105` | Đúng `MAX_REFRESH_COOKIES` giá trị ⇒ thu hồi từng giá trị; `MAX + 1` ⇒ 401 ngay, không thu hồi gì, vẫn log warn `{ count: MAX + 1, ip }` |

**B-1** (`login.use-case.ts:65`, `recordLogin` trả null): nhánh này đã được viết lại trong `fix/auth-login-pwchange-race` (G1 auth M1). Test 401 / không phiên cho cả hai trường hợp "mật khẩu vừa đổi" và "rehash thua" đã có ở đó. Ca riêng "user bị xóa giữa verify" sẽ thêm sau khi M1 merge, để tránh xung đột `login.use-case.test.ts`.

**P3 (B-8..B-12)** chưa làm (ưu tiên thấp). Sẽ làm cùng lượt helper unique (`refactor/unique-constraint-helper`) nếu còn thời gian.

## Kiểm (exit code)

| Lệnh | Exit | Ghi chú |
|---|---|---|
| `vitest run src/modules/auth test/http/auth.http.test.ts test/http/cookie-tossing.http.test.ts --maxWorkers=2` | 0 | 27 file / 270 test |
| Đột biến tay (sed từng dòng → chạy đúng test → `git checkout` file) | — | Bị giết cả 7: B-2, B-3, B-4, B-5 (bỏ `clear`), B-6 (bỏ `validate`), B-7 (`>` → `>=`, `>` → `> MAX+1`, bỏ log) |
