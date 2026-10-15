# T-014 Report — Auth: domain model + use cases (TDD, InMemory)

**Người làm:** Engineer B · **Branch:** `feat/T-014` · **Ngày:** 2026-10-15

## Lịch sử branch (quan trọng cho lúc merge)

```
036c367 feat(T-014): auth domain model, use cases and authenticate core
a6e8f72 fix(T-014): reject oversized passwords before NFC normalization   ← nit review T-013
9b3508f … (feat/T-009 bản cuối của A, merge vào)                           ← core kernel
c266a88 main
```

- Base = `main` mới nhất (c266a88) + merge `feat/T-009` **bản cuối** `9b3508f` (A báo DONE). Ban đầu tôi merge bản WIP `19bb795`; A sau đó rebase T-009 (nội dung giữ nguyên) nên tôi **dựng lại branch** trên `9b3508f` để Tech Lead merge T-009 rồi T-014 không bị trùng thay đổi. Đã kiểm `git diff` module auth trước/sau khi dựng lại = rỗng.
- Merge T-009 không xung đột (T-009 đã rebase lên main có T-013).
- Phụ thuộc trực tiếp: **T-014 cần T-009 merge trước.**

## Đã làm

Tất cả trong `apps/api/src/modules/auth/`.

| Ticket | File | Ghi chú |
|---|---|---|
| 1. Domain | `domain/user.ts`, `domain/user-events.ts`, `domain/refresh-token.ts`, `domain/email.ts` (sửa) | `User` (AggregateRoot của core): `register`, `recordLogin`, `replacePasswordHash` (rehash, không đổi tv), `changePassword` / `revokeAllSessions` (tv + 1 + event), `rename` (trim, 1–100 code point, không ký tự điều khiển). `RefreshToken`: hạn trượt 7 ngày / tuyệt đối 30 ngày, `assess(now)` ⇒ `valid \| expired \| revoked \| superseded (ân hạn 10s) \| reused`. Đổi trạng thái (xoay/thu hồi) đi qua repository bằng UPDATE có điều kiện, không qua entity. Events: `UserRegistered`, `UserPasswordChanged`, `UserSessionsRevoked` (không mang PII). |
| 2. Ports | `application/ports/user-repository.port.ts`, `refresh-token-repository.port.ts` (`markRotated` trả `false` khi thua race), `session-revocation-store.port.ts` (`read` 1 round-trip, `setTokenVersion` vs `primeTokenVersion` NX, `revokeSession`), `collaborators.port.ts` | Port DIP do auth định nghĩa, module khác hiện thực (ADR-093): `IWorkspaceProvisioner` (Register — module Workspace), `IMembershipReader` (GetMe — Workspace), `IAuthRealtimeNotifier` (ngắt socket — gateway Phase 3). |
| 3. Use cases | `application/use-cases/*.ts` | `RegisterUseCase`, `LoginUseCase`, `RefreshSessionUseCase`, `LogoutUseCase`, `LogoutAllUseCase`, `ChangePasswordUseCase`, `GetMeQuery`, `UpdateMeUseCase`; dùng chung `SessionIssuer` (cấp refresh + access) và `auth-shared.ts` (map PasswordPolicy ⇒ `ValidationError`, ghi cache best-effort). |
| 4. InMemory + fakes | `infrastructure/persistence/in-memory/*`, `testing/fakes.ts`, `testing/auth-harness.ts` | Repo InMemory có `snapshot()/restore()` ⇒ `FakeUnitOfWork` của A rollback thật; mô phỏng unique email. Store giả có chế độ `failing`. Harness dùng JWT thật (jose + FakeClock) và refresh token thật. |
| 5. `authenticate` | `application/access-token-authenticator.ts` | Hàm thuần, không phụ thuộc Express. Bearer ⇒ verify ⇒ `MGET` cache ⇒ miss: DB rồi `SET NX` ⇒ cache lỗi: fallback DB (tv + `isSessionRevoked`) ⇒ DB cũng lỗi: `503` (fail-closed). |
| Bỏ đồ tạm T-013 | xóa `application/ports/clock.port.ts`, `domain/auth-domain-error.ts` | Thay bằng `IClock` và `ValidationError` của core. |
| Nit review T-013 | `domain/password-policy.ts` (`exceedsMaxLength`), hasher | Kiểm rẻ `> 256 × 4` UTF-16 unit TRƯỚC khi NFC. Test bằng spy `String.prototype.normalize`. 256 chữ tiếng Việt dạng NFD (768 unit) vẫn hợp lệ. |

Use case ghi tuân ADR-012: realtime/cache/event chỉ chạy trong `uow.afterCommit` — các test kiểm `duringTransaction: false` qua `createSpy(uow)` của A.

## Bảng truy vết case "tầng U" (test-spec-auth-workspace.md phần Auth) → test

Tiền tố file: `apps/api/src/modules/auth/`.

| Case | Test | Ghi chú |
|---|---|---|
| REG-01 | `application/use-cases/register.use-case.test.ts` | 2 test: transaction + provisioner trong transaction + phiên; event sau commit |
| REG-02, 03, 04, 05, 06, 07, 08, 10, 11, 12, 13 | như trên | REG-04..07 gộp 1 test chính sách + 1 test biên hợp lệ |
| REG-09 | như trên | Mức use case: field lạ bị bỏ qua (không spread input). Zod strict ⇒ 400 là việc của presentation (Phase 3). |
| REG-13b | — | Sinh slug (`nguyen-van-duc`, slug dành riêng, < 3 ký tự) là việc của **module Workspace** (hiện thực `IWorkspaceProvisioner`). Auth chỉ đảm bảo provisioner nhận họ tên, không nhận email (REG-13). |
| LOG-01 … LOG-07 | `application/use-cases/login.use-case.test.ts` | LOG-04 có thêm ca email sai định dạng |
| REF-01, 02, 03, 04, 05, 07, 08, 09, 10, 11, 12, 14 | `application/use-cases/refresh-session.use-case.test.ts` | REF-03: phần "xóa cookie" ở presentation; use case ném `RefreshTokenInvalidError` |
| REF-06 (thuộc I) | như trên | Thêm bản mức U: thua race ở `markRotated` ⇒ 409 + rollback token mới. Bản race thật vẫn là test I (Phase 3). |
| OUT-01, OUT-02 | `application/use-cases/logout.use-case.test.ts` | + ca Valkey lỗi |
| ALL-01, ALL-04 | `application/use-cases/logout-all.use-case.test.ts` | |
| PWD-01, 02, 03, 04, 07 | `application/use-cases/change-password.use-case.test.ts` | PWD-03 có ca NFC vs NFD |
| MW-01 … MW-08 | `application/access-token-authenticator.test.ts` | + cache miss & DB lỗi ⇒ 503; user xóa ⇒ không SET NX; SET NX lỗi ⇒ vẫn qua |
| ME-01, ME-02, ME-03 | `application/use-cases/me.use-cases.test.ts` | ME-03 như REG-09 |
| (ngoài spec) | `domain/user.test.ts`, `domain/refresh-token.test.ts` | Invariant domain |

## Definition of Done (worktree, Windows, Node 24.18.0, pnpm 11.28.2)

```
$ pnpm typecheck        → packages/config, contracts, apps/api, apps/web: Done
$ pnpm lint             → prettier ✔ · eslint ✔ · depcruise api: ✔ no dependency violations found (113 modules, 316 dependencies cruised)
$ pnpm test             → Test Files 34 passed (34) · Tests 393 passed (393)

$ vitest --project api --coverage (include **/modules/auth/**, trừ *.test.ts, testing/**, *.port.ts)
Statements 98.27% (455/463) · Branches 95.28% (202/212) · Functions 99.36% · Lines 99.26%
  domain          statements 99.2%  branches 98.1%   (yêu cầu ≥ 90%)
  application     statements 99.0%  branches 97.4%   (yêu cầu ≥ 80%)
  infrastructure  statements 96.6%  branches 91.7%
```

## Quyết định tự đưa ra

1. **Register thử lại slug:** provisioner nhận `attempt` (0 = slug gốc, ≥ 1 = thêm hậu tố) và ném `ResourceConflictError(field='slug')`. Register thử lại **cả** `uow.run` tối đa 5 lần (lỗi unique làm hỏng transaction Postgres), mật khẩu chỉ băm một lần. Email trùng **không** thử lại.
2. **Kiểm đầu vào trước khi băm:** email → họ tên → chính sách mật khẩu → `hash()` (ngoài transaction).
3. **Login với email sai định dạng** được xử lý như email không tồn tại (vẫn verify hash giả, cùng lỗi 401) thay vì 400 — không cho phân biệt.
4. **Phát hiện reuse:** thu hồi family trong một transaction riêng rồi mới ném 401. Log bảo mật `refresh.reuse_detected` (userId, familyId, không có token) và `sid-revoked` + ngắt socket chạy sau commit.
5. **Ghi cache sau commit là best-effort** (`auth.session_cache_write_failed` mức warn). DB là nguồn sự thật; `authenticate` đọc DB khi cache miss.
6. **ChangePassword:** đọc user ngoài transaction để verify (argon2 chậm), **đọc lại trong transaction** trước khi ghi. Mật khẩu mới trùng mật khẩu cũ (so sau NFC) ⇒ `400` code `same_as_current`.
7. **Socket:** dùng port `IAuthRealtimeNotifier` gọi trực tiếp sau commit (khớp test spec `disconnectSession`/`disconnectUser`), thay vì để gateway nghe domain event. Domain event vẫn được publish cho listener khác.
8. `ACCESS_TOKEN_TTL_SECONDS = 900` đặt ở `auth-shared.ts`, dùng cho cả TTL của `sid-revoked` lẫn cấu hình JWT ở harness. Composition root (Phase 3) phải truyền **cùng** giá trị cho `JoseAccessTokenService`.
9. Fakes và harness để ở `modules/auth/testing/` (trong phạm vi sở hữu). Thư mục này được phép import infrastructure; test ở `application/` chỉ import qua harness (dependency-cruiser đã bắt một lần vi phạm, đã sửa).

## Trung thực về TDD

Domain (`User`, `RefreshToken`), RefreshSession, Logout, LogoutAll, ChangePassword, GetMe/UpdateMe và nit T-013 được viết **test trước, chạy đỏ, rồi mới hiện thực**. Riêng **Register, Login và AccessTokenAuthenticator** tôi viết hiện thực cùng lúc với test (không có lần chạy đỏ riêng). Các test này vẫn bao trọn case của spec.

## Rủi ro / ghi chú cho Phase 3

- **Prisma repository (ticket sau, chờ T-010):**
  - `markRotated` / `revokeFamily` / `revokeAllForUser` phải là `updateMany` có điều kiện `revokedAt: null` và kiểm `count`.
  - `add` user phải map P2002 trên `email` ⇒ `EmailAlreadyExistsError`.
  - `save(user)` ghi `tokenVersion` tuyệt đối. Hai logout-all đồng thời có thể cùng ghi tv = n + 1 — vẫn an toàn (mọi token cũ có tv ≤ n đều bị từ chối), nhưng nếu muốn chặt hơn thì dùng `increment`.
- **Test chập chờn:** `packages/config` (`depcruise-architecture`, `eslint-architecture`) từng timeout 10s một lần khi chạy cả suite dưới tải, chạy lại thì xanh (2s khi chạy riêng). Là test của A, báo để biết.
- **ADR-097:** Origin mặc định khi dev là `http://localhost:3001`. Kiểm Origin cho `/auth/refresh` và `/auth/logout` dùng `requireAllowedOrigin` của core (A), gắn ở presentation Phase 3.

## Câu hỏi mở

- Hiện thực `IWorkspaceProvisioner` / `IMembershipReader` thuộc ticket Workspace nào? Hợp đồng `attempt` + `ResourceConflictError(field='slug')` cần được bên đó tuân theo (mô tả trong `collaborators.port.ts`).
