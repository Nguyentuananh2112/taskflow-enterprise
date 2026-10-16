# F3 — Mutation testing auth / workspace / task (Engineer F, QA độc lập)

**Branch:** `feat/F3` (worktree `D:\TaskFlow_wt\T-017b`, ADR-107) · **Snapshot:** main d647383 · **Ngày:** 2026-10-16
**Công cụ:** StrykerJS `@stryker-mutator/core` 10.0.0, `testRunner: "command"`, `coverageAnalysis: "off"`, concurrency 2. Cấu hình này giữ nguyên từ T-017 vì vitest-runner 10.0.0 sai với Vitest 5 (`stryker/base.mjs`). Các module chạy **tuần tự**, mỗi module đều có lượt "máy rảnh" do Tech Lead cấp.

Ký hiệu: **[GAP]** test thiếu, cần thêm · **[EQ]** mutant tương đương, không cần làm gì · **[LOW]** chỉ đổi chuỗi log/thông điệp. Ưu tiên: P1 (bảo mật/vận hành) > P2 (hành vi/contract) > P3.
Score = (killed + timeout) / tổng, theo cách tính của Stryker. Timeout được tính là "đã phát hiện", cùng kết luận với T-017 §B.2 (máy tải nặng; mutant sửa tay tương ứng bị giết bằng assertion).

## 1. Phạm vi và nhóm

| Nhóm | File bị đột biến | Test chạy cho mỗi mutant |
|---|---|---|
| auth-domain / -application | `src/modules/auth/{domain,application}/**` | `src/modules/auth` |
| auth-infrastructure | `src/modules/auth/infrastructure/**` **trừ** `persistence/prisma/**`, `cache/valkey-*` | `src/modules/auth` |
| auth-presentation *(mới)* | `src/modules/auth/presentation/**` | `src/modules/auth`, `test/http` |
| workspace-domain / -application *(mới)* | `src/modules/workspace/{domain,application}/**` | `src/modules/workspace` |
| workspace-infrastructure *(mới)* | `src/modules/workspace/infrastructure/jobs/**` | `src/modules/workspace`, `src/composition/maintenance-jobs.test.ts` |
| workspace-presentation *(mới)* | `src/modules/workspace/presentation/**` | `src/modules/workspace`, `test/http` |
| task-domain / -application *(mới)* | `src/modules/task/{domain,application}/**` | `src/modules/task` |
| task-infrastructure *(mới)* | `src/modules/task/infrastructure/rank/**` | `src/modules/task` |
| task-presentation *(mới)* | `src/modules/task/presentation/**` | `src/modules/task`, `test/http` |

**Ngoài phạm vi (TL duyệt 2026-10-16):** repo Prisma (cả 3 module) và store Valkey của auth. Phần này chỉ có integration test phủ (`test/integration/**`, gồm runner LSP). Nếu đột biến bằng unit test thì mọi mutant đều "sống" giả: đo trên auth là **0 killed / 204 mutant**. Lượt chạy này đã gồm 204 mutant đó (con số "thô" ở §2). Config `auth-infrastructure` hiện đã loại chúng, nên lượt hằng tuần trên CI không còn nhiễu. Repo in-memory của workspace/task cũng không đột biến, vì đó là test double. Riêng repo in-memory của auth vẫn giữ để so được với T-017.
Chạy mutation trên repo Prisma bằng `test:integration` thì mỗi mutant tốn vài phút DB thật. Không khả thi hằng tuần trên máy dev; nếu cần, đó là một ticket riêng có job CI dùng service container.

Mỗi nhóm có script `pnpm --filter @taskflow/api mutation:<nhóm>`. Workflow `mutation.yml` tự nhận nhóm mới từ script nên không phải sửa workflow.

## 2. Kết quả

| Nhóm | Mutant | Killed | Timeout | Survived | **Score** | T-017 (2026-10-15) | Thời gian |
|---|---|---|---|---|---|---|---|
| auth-domain | 229 | 221 | 0 | 8 | **96.51%** | 94.32% (229) | 9m14s |
| auth-application | 358 | 315 | 1 | 42 | **88.27%** | 86.14% (267) | 11m32s |
| auth-infrastructure (thô) | 595 | 366 | 0 | 229 | 61.51% | 82.55% (321) | 20m22s |
| auth-infrastructure (trừ Prisma/Valkey) | 391 | 366 | 0 | 25 | **93.61%** | — | — |
| auth-presentation | 120 | 98 | 12 | 10 | **91.67%** | (nhóm mới) | 14m57s |
| **auth (trừ Prisma/Valkey)** | **1098** | **1000** | **13** | **85** | **92.26%** | — | ~56 phút |
| workspace-* | — | — | — | — | *chờ lượt máy* | | |
| task-* | — | — | — | — | *chờ lượt máy* | | |

Cả 4 nhóm auth exit 0. Sau khi phân loại, 85 mutant sống chia thành **[GAP] 20** (gom thành 12 test đề xuất bên dưới), **[EQ] 33** và **[LOW] 32**.

**Mutant kiểm chứng thủ công:** `access-token-authenticator.ts:55`, toàn bộ điều kiện thu hồi đổi thành `if (false)`, chạy đúng lệnh test của nhóm: exit 1, **8 test đỏ** (MW-04/05/06, X3 refill). Runner báo Killed là thật. Mutant cùng dòng mà Stryker báo "sống" chỉ thay **toán hạng đầu** (`state.tokenVersion === null` → `false`), nên là [EQ] vì `null !== tv` vẫn ném. Đã khôi phục file; `git status src` sạch.

## 3. Findings auth gửi **Engineer B**

### [GAP]

| # | Ưu tiên | Vị trí | Đột biến sống | Vì sao test không bắt | Test đề xuất |
|---|---|---|---|---|---|
| B-1 | P2 | `application/use-cases/login.use-case.ts:65` | bỏ `if (tokenVersion === null) throw` | Contract repo có test `recordLogin` của user đã xóa trả `null`, nhưng **use case** chưa có test cho nhánh "user bị xóa trong lúc verify argon2" (ADR-104) | Harness: xóa user giữa `verify` và `recordLogin` (hasher giả có hook), sau đó assert `InvalidCredentialsError` và `issuer.startNew` **không** được gọi, không có refresh token mới |
| B-2 | P2 | `logout-all.use-case.ts:35` | bỏ `throw` khi `bumpTokenVersion` trả `null` | như trên | user bị xóa giữa `findById` và `bumpTokenVersion` thì `UnauthorizedError`, không ghi `tv` vào store |
| B-3 | P2 | `change-password.use-case.ts:82` | `!user \|\| user.isDeleted` → `false` / `&&`; bỏ `throw` | Không có test cho user bị xóa **sau** bước verify mật khẩu hiện tại (hash mới tính ngoài transaction, PWD-07) | Xóa mềm user trong lúc `hasher.hash`, assert `UnauthorizedError`, `password_hash` không đổi, không thu hồi token |
| B-4 | P2 | `update-me.use-case.ts:21-22` | bỏ nhánh `updateProfile(...) === false` | Contract repo có test, use case thì chưa | `updateProfile` trả `false` (user bị xóa giữa chừng) thì `UnauthorizedError`, không trả `UserView` |
| B-5 | P2 | `presentation/auth.controller.ts:125` | bỏ `this.d.cookie.clear(res)` ở `logoutAll` | Test HTTP logout-all chỉ kiểm 204 | `POST /auth/logout-all` (204) phải có `Set-Cookie: tf_rt=; Max-Age=0; Path=…` (security §1.4) |
| B-6 | P2 | `presentation/auth.routes.ts:62` | `validate({ body: ChangePasswordBody })` → `validate({})` | Không có test HTTP cho body sai của change-password | Body `{}` / `newPassword` số thì **400** `VALIDATION_FAILED` (không phải 500) |
| B-7 | P2 | `auth.controller.ts:104-105` | `count > MAX_REFRESH_COOKIES` → `>=`; bỏ log `auth.refresh_cookie_ambiguous` ở nhánh flood | Thiếu test biên của chống khuếch đại cookie tossing (T-028) | Đúng `MAX` cookie trùng tên thì thu hồi từng cái (logout ×MAX); `MAX+1` thì 401 **không** gọi logout; cả hai đều có log warn `count` |
| B-8 | P3 | `application/access-token-authenticator.ts:98` | `ttlSeconds > 0` → `true` / `>= 0` | Không có phiên bị thu hồi đúng biên cửa sổ TTL | Fake clock: `revokedAt = now − TTL` (ttl tính ra 0) thì **không** gọi `revokeSession`; `now − TTL + 1s` thì gọi với ttl 1 |
| B-9 | P3 | `access-token-authenticator.ts:35` | regex `\s*$` → `\S*$` | Không có header `Bearer <token>` kèm khoảng trắng cuối | Chốt hành vi: `"Bearer <tok>  "` thì 200 (đang chấp nhận) |
| B-10 | P3 | `infrastructure/security/argon2id-password-hasher.ts:71` | bỏ so sánh `version` trong `needsRehash` | Test chỉ đổi m/t/p | Hash `$argon2id$v=16$…` cùng tham số thì `needsRehash` = `true` |
| B-11 | P3 | `presentation/refresh-cookie.ts:67, 69` | `eq < 0` → `false`; bỏ `.trim()` giá trị | Không có phần cookie thiếu `=` hoặc giá trị có khoảng trắng | `Cookie: tf_rtX` (không `=`) thì `readAll` = `[]` (mutant đếm thành 1 token, làm lệch ngưỡng flood); `tf_rt= abc` thì `['abc']` |
| B-12 | P3 | `refresh-cookie.ts:48` | giá trị cookie khi `clear` thành chuỗi khác `''` | Test chỉ kiểm `Max-Age=0` | Assert `Set-Cookie` bắt đầu bằng `tf_rt=;` |

### [EQ] (không cần làm gì)

| Vị trí | Vì sao tương đương |
|---|---|
| `domain/email.ts:34` (`length === 0` → false), `:37` (giá trị mặc định khi tách) | Chuỗi rỗng bị nhánh tách `@` chặn; `split` luôn trả chuỗi |
| `domain/password-policy.ts:41, 46` (`> MAX_UTF16_UNITS` → `>=`) | `MAX_UTF16_UNITS = 256 × 4 = 1024`. Mỗi code point tối đa 2 đơn vị UTF-16, nên chuỗi 1024 đơn vị có ≥ 512 code point và đằng nào cũng `TOO_LONG` |
| `access-token-authenticator.ts:45` (`?? ''` → chuỗi khác), `:55` (toán hạng đầu) | Chuỗi khác vẫn không khớp `BEARER`; `null !== tv` vẫn ném (đã kiểm tay, §2) |
| `login.use-case.ts:85-86` (`catch` của `#findUser`) | `Email.create` chỉ ném `ValidationError` |
| `refresh-session.use-case.ts:54` (`'superseded'` → `""`) | Rơi khỏi `switch` thì vào transaction, rồi `markRotated` có điều kiện thua và vẫn ra `RefreshInProgressError` (lớp thứ hai; test 95/113 vẫn xanh). Ghi chú cho B: assertion không kiểm "không mở transaction". Có thể thêm spy, không bắt buộc |
| `refresh-session.use-case.ts:58, 62` (bỏ `throw` sau reuse; `case 'valid'`) | `switch` rơi xuống `case 'expired'` thì vẫn ném cùng lỗi; `valid` không khớp case nào thì vẫn ra khỏi `switch` |
| `refresh-session.use-case.ts:71, 72` | `tv === null` thì dòng 71 đã cho `user = null`, nên `!user` vẫn ném; nhánh `&&` chỉ khác khi `lockTokenVersion` có giá trị mà `findById` trả `null`, không xảy ra trong cùng transaction (FK + khóa dòng) |
| `refresh-session.use-case.ts:99` (`bestEffort` sau commit → no-op) | Lần ghi lặp `revokeSession` sau commit; lần ghi bắt buộc trước commit (`writeRevocationOrFail`) vẫn còn và đã có test |
| `register.use-case.ts:44` (`details?.` → `details`) | Mọi `ResourceConflictError` từ repo đều kèm `details` |
| `auth.routes.ts:31` (bỏ `router.use(noStore)`) | `app.ts:90` đặt `Cache-Control: no-store` cho toàn bộ `/api/v1` (L4 T-028) nên test `auth.http` vẫn xanh. Đây là lớp phòng thủ kép, giữ nguyên |
| `refresh-cookie.ts:65, 67 (<= 0)` | `''` mặc định; phần `=abc` cho tên rỗng, khác `tf_rt` |
| `jose-access-token-service.ts:16` (`requiredClaims` → `[]`), `:113-114` (kiểu `tv`/`iat`/`exp`) | `toClaims` tự kiểm từng claim; `Number.isSafeInteger` bắt kiểu khác số; jose tự kiểm kiểu `iat`/`exp` |
| `jose-access-token-service.ts:54, 67, 85, 86 (điều kiện)`, `:31` (độ dài `kid`) | Khóa trùng giá trị chỉ đăng ký thừa; `keys.get(undefined)` vẫn ra `undefined`; key `undefined` thì jose từ chối; `kid` không được kiểm từ bên ngoài |
| `jose-access-token-service.ts:111` (`typeof v === 'string'` → true) | Chỉ khác khi payload có `sid`/`jti` kiểu mảng, mà điều này cần chữ ký hợp lệ (phải có secret). Ghi lại, không coi là GAP |

### [LOW]

Thông điệp tiếng Việt: `domain/user.ts:29-31`, `auth-shared.ts:33-36`, `change-password:74`, `register:67`, `argon2…:49`, `jose…:37, 53, 57, 67, 86`. Trường/khóa log: `auth-shared.ts:79`, `access-token-authenticator.ts:66, 76`, `change-password:106`, `logout-all:47`, `logout:42`, `refresh-session:99`. Repo in-memory (test double): `in-memory-refresh-token.repository.ts:16, 67` (×4; P3: test `listRevokedSessionsSince` khi một family bị thu hồi 2 lần thì lấy mốc **mới nhất**), `in-memory-session-revocation.store.ts:49`.

Ghi chú: `auth-shared.ts:33-36` là thông điệp hiện trong `details.issues[].message`. Nếu web hiển thị nguyên văn (E4) thì nên có 1 snapshot test. Hiện tôi để P3/LOW.

## 4. Findings workspace gửi **B** · task gửi **A**

*Chờ lượt máy* (Tech Lead: tạm dừng mutation cho lượt k6 của D, chạy tiếp khi D báo xong).

## 5. Cổng chen trong phiên

| Cổng | Snapshot | Lệnh | Kết quả |
|---|---|---|---|
| E5 (E — `feat/E-layout-g2` @ 96a67aa) | 8367e04 = main fc75215 + merge 96a67aa (worktree riêng của F trên C:) | `next build` (prod, BUILD_ID `u5tQNmNdQQrueXs24vch_`) + `E2E_MOBILE=1 playwright test` | **exit 0: 41 passed / 0 failed / 1 skipped** (E2E-16, fixme thuộc CI), 2.2 phút. E2E-02/03/03b/04 + mobile 412px + axe sáng/tối + SEC-48/48b xanh |

## 6. File

- `apps/api/stryker/*.config.mjs`: 9 nhóm mới, và `auth-infrastructure` loại Prisma/Valkey.
- `apps/api/package.json`: 9 script `mutation:<nhóm>`.
- `docs/tasks/BACKLOG.md`: nhận F3.
- `e2e/scripts/integration-isolation-gate.mjs`: nhận biến `F2_GATE_PG` (gốc kết nối migrator, không kèm tên DB; mặc định giữ postgres-test local 5434). Đây là đề xuất của D (ci-parity-report, "Đề xuất cho điểm 5"), làm script chạy được trên CI. Đã qua `node --check`; chưa chạy lại cổng vì máy đang nhường k6.
- Không sửa `apps/*/src/**`. Mutant kiểm chứng tay sửa tạm 1 file rồi khôi phục.
