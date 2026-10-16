# G1 auth M1 + L1 — Login bằng mật khẩu cũ giữ phiên qua lần đổi mật khẩu

**Người làm:** Engineer B · **Branch:** `fix/auth-login-pwchange-race` · **Ngày:** 2026-10-16
**Nguồn:** `docs/reviews/G1-auth-crossread.md` (D, M1 Medium + L1 Low)

## Lỗi

`LoginUseCase` verify argon2 **ngoài** transaction rồi gọi `recordLogin(id, at)`. Câu UPDATE của lệnh này chỉ kiểm `deleted_at IS NULL` và trả `token_version` **hiện tại**.

Kịch bản: change-password commit trong cửa sổ verify (vài trăm ms). Lúc đó:
- `revokeAllForUser` của lần đổi đã chạy xong;
- login vẫn tạo refresh token mới và ký access token bằng tv mới.

Kết quả: người chỉ biết **mật khẩu cũ** có phiên 30 ngày hợp lệ, trong khi đổi mật khẩu chính là cách người dùng đá họ ra. SEC-23b khi đó lại chấp nhận hành vi này (`expect(ok).toBe(tv === 1)`).

## Đã sửa

| File | Thay đổi |
|---|---|
| `application/ports/user-repository.port.ts` | `recordLogin({ id, expectedHash, at })` — có điều kiện `password_hash = expectedHash`; `null` ⇒ user không còn **hoặc** mật khẩu vừa đổi |
| `infrastructure/…/prisma-user.repository.ts` | `UPDATE … WHERE id AND deleted_at IS NULL AND password_hash = $expectedHash RETURNING token_version`. READ COMMITTED: UPDATE chờ khóa dòng của change-password rồi đánh giá lại WHERE trên bản đã commit. Nếu login đi trước thì change-password chờ login commit, nên `revokeAllForUser` thấy phiên mới và thu hồi nó |
| `infrastructure/…/in-memory-user.repository.ts`, `composition/users.ts` | Cùng chữ ký |
| `application/use-cases/login.use-case.ts` | `expectedHash` = hash mới nếu `rehashPassword` **thắng** (trước đây bỏ qua kết quả boolean), ngược lại = hash đã verify. `null` ⇒ `InvalidCredentialsError` (401 như sai mật khẩu, không tiết lộ vừa đổi) |
| `application/use-cases/refresh-session.use-case.ts` (L1) | Nhánh `reused` mà `revokeFamily` trả 0 (family đã chết vì LOGOUT / LOGOUT_ALL / PASSWORD_CHANGED / reuse trước đó) ⇒ log `info refresh.replay_after_revocation` thay vì `warn refresh.reuse_detected`. Vẫn ghi `sid-revoked` + ngắt socket (fail-closed giữ nguyên). Hết báo động giả trên kênh X9 |

## Test

| Test | Nội dung |
|---|---|
| Contract `IUserRepository` (in-memory + Prisma) | Hash đã đổi ⇒ `recordLogin` trả `null`, `last_login_at` không đổi; hash mới ⇒ tv |
| Unit `login.use-case.test.ts` | Test ADR-104 cũ (khẳng định login **thành công** với tv mới) đổi thành: 401, không refresh token, không hồi sinh hash. Thêm ca không rehash: verify trả true rồi change-password commit ⇒ 401 |
| Unit `refresh-session.use-case.test.ts` REF-04b | Family đã thu hồi LOGOUT_ALL + dùng lại T1 sau 11 s ⇒ 401, lý do gốc giữ nguyên, không có `reuse_detected`, có `replay_after_revocation` |
| Integration SEC-23b ×20 | Không còn chấp nhận phiên sống sót. Login thành công ⇒ access bị từ chối **và** family đã thu hồi; thất bại ⇒ đúng `InvalidCredentialsError`; không còn refresh token sống ngoài phiên change-password cấp |
| Integration **SEC-23e** (mới, tất định, ×2: rehash false/true) | Login dừng ngay sau verify; change-password chạy xong; thả login ⇒ 401, không token sống, hash = mật khẩu mới |

**Đỏ trên code cũ** (stash 5 file nguồn, giữ test mới, Postgres thật):
- SEC-23e cả 2 ca ĐỎ: `access token tv=1 vẫn hợp lệ: expected true to be false`;
- unit + contract mới ĐỎ.

SEC-23b là đua ngẫu nhiên: lượt chạy trên code cũ không trúng cửa sổ (xanh) ⇒ **cổng thật là SEC-23e**. SEC-23b giữ vai trò bắt hồi quy theo xác suất.

## Kết quả kiểm (exit code)

Trên `main` @ `25ba093`; DB riêng `taskflow_b_m1` / `taskflow_b_sec`; Valkey db 12 / 13.

| Lệnh | Exit | Ghi chú |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | |
| `VITEST_MAX_WORKERS=2 REQUIRE_INTEGRATION=1 VERIFY_DB_URL=<taskflow_b_m1> pnpm verify` | 0 | 1711 test unit; audit high/critical: 0; `db:check-drift`: No difference |
| `pnpm --filter @taskflow/api test:integration` (DB `taskflow_b_m1`, Valkey db 12, không `VITEST_MAX_WORKERS`) | 0 | 44 file / 381 test |
| `pnpm --filter @taskflow/api test:security` (mặc định) | 0 | 4 file chạy, 6 file skip (case `pending`) |
| `SEC_RUN_PENDING=all … test:security` | 0 | **10/10 file, 89 test** (gồm SEC-21c / 23b / 23c HTTP) + 36 todo |
| `auth-races.int.ts` trên code CŨ (5 file nguồn stash) | 1 | SEC-23e ×2 đỏ như mong đợi |

**Phát hiện phụ:** CI không đặt `SEC_RUN_PENDING` ⇒ 44 ca bảo mật hộp đen (auth, cookie-tossing, …) bị **skip trên CI**, dù route đã có từ lâu. Báo Tech Lead + F (chủ suite).

## Quyết định (đề xuất cho Tech Lead chép thành ADR — mở rộng ADR-104)

**Mọi lệnh intent mà login ghi sau khi verify mật khẩu ngoài transaction phải có điều kiện theo hash đã verify** (`password_hash = expectedHash`). Điều kiện sai ⇒ không cấp phiên (401 chung).

Tổng quát: một use case kiểm bí mật ngoài transaction rồi cấp quyền trong transaction ⇒ câu ghi cấp quyền phải kiểm lại đúng giá trị bí mật đã dùng. Không dựa vào việc "lệnh thu hồi đã chạy" (thu hồi chỉ thấy phiên đã commit trước nó).

## Rủi ro / ghi chú

- Người dùng đăng nhập đúng lúc chính họ (ở thiết bị khác) đổi mật khẩu sẽ nhận 401 một lần ⇒ đăng nhập lại bằng mật khẩu mới. Chấp nhận.
- `auth.login_failed` không được ghi cho ca này (không phải sai mật khẩu). Có thể thêm sự kiện riêng nếu cần forensics; chưa làm.
- I1 của D (409 thay vì 401 khi refresh xen logout-all) không sửa: tự hội tụ sau 1 vòng.
