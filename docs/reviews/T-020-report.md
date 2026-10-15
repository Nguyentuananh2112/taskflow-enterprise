# T-020 Report — Prisma repositories Auth + Workspace, test tầng I, sửa A3/A4

**Người làm:** Engineer B · **Branch:** `feat/T-020` · **Ngày:** 2026-10-15

## Commit

- `docs(T-020)` — **Việc 0**: test spec §0.2 + ROL-06 dùng `unassignAllForUser({ workspaceId, userId, actorId })`.
- `feat(T-020)` — toàn bộ phần còn lại (gộp các commit WIP; pre-commit hook gitleaks + prettier + eslint đều xanh).

## Mở rộng phạm vi trong ticket (đều do Tech Lead duyệt)

1. **A4 — lost update trên `users` (ADR-104):**
   - Bỏ `IUserRepository.save`. Thay bằng lệnh nguyên tử theo mục đích: `recordLogin` (RETURNING `token_version`), `rehashPassword` (có điều kiện `password_hash = oldHash`), `changePassword` (có điều kiện + `token_version + 1` cùng câu lệnh, RETURNING), `bumpTokenVersion` (RETURNING), `updateProfile`.
   - Login / ChangePassword / LogoutAll / UpdateMe dùng các lệnh này. `SessionIssuer` nhận `{ id, tokenVersion }` và ký bằng `tv` lấy trong cùng transaction.
   - Tech Lead xác nhận: (1) dùng RETURNING tv; (2) changePassword thua race ⇒ `400 INVALID_CURRENT_PASSWORD`.
2. **A3 — thu hồi fail-open (ADR-105):**
   - logout / logout-all / change-password / reuse-detected ghi `sid-revoked` hoặc `tv` mới vào Valkey **trước commit** (`writeRevocationOrFail`). Lỗi ⇒ `503` + rollback. Sau commit ghi lại (best-effort).
   - Read-through chỉ `SET NX`; TTL `auth:tv` = 60s.
3. **QA §B.4:** test cho mọi [GAP] P1/P2 của module auth (bảng dưới) và **bộ contract test dùng chung** InMemory ↔ Prisma/Valkey.
4. **security.md** §1.4–1.7, §2.4, SEC-24 cập nhật theo ADR-104/105, kèm lý do bác "DEL trước commit".
5. **`src/composition/users.ts`** (của T-021): `MirroringUserRepository` theo port mới. Chỉ `updateProfile` cần phản chiếu (đọc lại User rồi `#reflect`). Đã báo A (T-024): hook `onWrite(user)` của A gắn vào cuối `#reflect` là đủ.
6. **Test của chính module auth/workspace** (`testing/`, `*.test.ts`) được chỉnh để không phụ thuộc backend:
   - id fixture dạng UUID (`uid()`/`pid()`/`wsid()`, `GHOST_ID`);
   - `await rows()`;
   - harness nhận backend tiêm vào.
   Mục đích: chạy lại nguyên bộ test use case với Prisma (yêu cầu 5 của ticket).

7. **Wire Prisma vào composition root** (quyết định Tech Lead, T-020 merge trước A):
   - **`createPrismaPersistence({ prisma, valkey, logger })`**:
     - repository Prisma auth + workspace dùng chung `PrismaUnitOfWork` (timeout transaction 10s);
     - session store Valkey;
     - không dùng `MirroringUserRepository`, vì repository Prisma đọc thẳng bảng `users`.
   - **`Persistence.modules`** khai lưu trữ thực của từng module. `assertPersistenceAllowed(appEnv, modules)` hoạt động như sau:
     - **staging/production** có bất kỳ module nào chạy bộ nhớ (kể cả chế độ lai) ⇒ throw, từ chối khởi động;
     - **local/test** ⇒ trả danh sách module bộ nhớ, `main.ts` log cảnh báo `persistence.in_memory_data_lost_on_restart`.
   - **Biến môi trường** `PERSISTENCE` và `PERSISTENCE_TASK` (`prisma|memory`, mặc định `prisma`). Trong `env.ts`, nếu `APP_ENV ∈ {staging, production}` và một biến là `memory` ⇒ lỗi cấu hình nêu đúng tên biến. Như vậy có hai lớp chặn: env và module đã wire.
   - **`main.ts`** dùng `PERSISTENCE=prisma` (mặc định; `DATABASE_URL` vốn bắt buộc) ⇒ `PrismaClient` qua adapter-pg trên pool sẵn có. Graceful shutdown đóng `prisma.$disconnect()` trước `db-pool`. Valkey vẫn đóng như cũ.
   - **Test khởi động** `test/integration/startup/prisma-startup.int.ts` spawn `src/main.ts` thật:
     1. Prisma + Valkey trên `taskflow_t020`: `/readyz` 200; register 201 → login 200 → me 200 → logout-all 204 → me 401. `token_version` = 1 trong Postgres, 1 workspace, không có cảnh báo bộ nhớ.
     2. `APP_ENV=staging` + `PERSISTENCE_TASK=memory` ⇒ exit ≠ 0, output nêu `PERSISTENCE_TASK`.

### File composition đã đổi (A cần rebase)

| File | Thay đổi |
|---|---|
| `apps/api/src/main.ts` | chọn persistence, gọi `assertPersistenceAllowed` + cảnh báo, đóng Prisma khi shutdown |
| `apps/api/src/composition/persistence.ts` (+ `persistence.test.ts` mới) | `StorageKind`, `Persistence.modules`, `createPrismaPersistence`, `assertPersistenceAllowed` |
| `apps/api/src/composition/users.ts` | `MirroringUserRepository` theo port ADR-104 (mục 5) |
| `apps/api/src/config/env.ts` (+ `env.test.ts`) | `PERSISTENCE`, `PERSISTENCE_TASK`, luật staging/production |
| `apps/api/.env.example` | `PERSISTENCE=prisma`, `PERSISTENCE_TASK=memory` (local, cho tới khi Task có Prisma) |

**Việc của A (T-024) khi rebase:**
- thêm `task` vào `Persistence.modules` (`'memory'` hoặc `'prisma'` theo `env.PERSISTENCE_TASK`). Nếu thiếu, guard production không thấy module Task;
- đưa repository Task vào `createPrismaPersistence` khi có.

## Đã làm (theo ticket)

| # | Nội dung | File chính |
|---|---|---|
| 1 | Repository Prisma dùng `uow.db()` (không tự mở transaction) cho mọi port auth + workspace | `modules/auth/infrastructure/persistence/prisma/*`, `modules/workspace/infrastructure/persistence/prisma/*` |
| 1a | `markRotated` / `revokeFamily` = `updateMany … WHERE revoked_at IS NULL` + kiểm `count` | `prisma-refresh-token.repository.ts` |
| 1b | `lockOwners` = `SELECT … FOR UPDATE ORDER BY id` (`$queryRaw`) | `prisma-repositories.ts` |
| 1c | Assignee `FOR SHARE OF m`; `allocateTaskNumber` = `UPDATE … RETURNING` (có `archived_at IS NULL`, ws chưa xóa, `updated_at = now()` — C phát hiện thiếu) | `prisma-task-ports.ts` |
| 1d | Purge: `pg_try_advisory_xact_lock(hashtextextended('taskflow:purge:'+id))` + khóa dòng + kiểm lại `purge_at` + xóa audit → task theo project, lô 5 000, rồi workspace (cascade) | `prisma-workspace.purger.ts` |
| 2 | Phía đọc: `select` thẳng, phạm vi tenant, loại ws xóa mềm; tìm member `ILIKE … ESCAPE '\'` (escape `%`, `_`, `\`); keyset `(joined_at, id)` / `(created_at, id)` | `prisma-queries.ts` |
| 3 | `ValkeySessionRevocationStore` (node-redis 6: `mGet`, `set` với `expiration` / `condition: 'NX'` — cú pháp không deprecated của 6.3.0) | `auth/infrastructure/cache/valkey-session-revocation.store.ts` |
| 4 | Test tầng I (bảng truy vết dưới) | `test/integration/{auth,workspace}/*.int.ts` |
| 5 | **LSP**: chạy lại NGUYÊN bộ test use case auth + workspace với repo Prisma, chỉ đổi factory harness (`vi.mock`) | `test/integration/lsp/*.lsp.int.ts` (14 file) |
| + | Adapter cho module Task (chốt với C): `PrismaAssigneeDirectory`, `PrismaTaskProjectStore`, `PrismaUserRefReader` — đang khai bản sao cục bộ của interface, `TODO(T-018)` đổi sang `import type … from '../../task'` | `prisma-task-ports.ts`, `prisma-user-ref.reader.ts` |

### Phát hiện kỹ thuật cần biết

- **Lỗi unique của Prisma 7 + `@prisma/adapter-pg` KHÔNG có `meta.target`.** Tên constraint nằm ở `meta.driverAdapterError.cause.constraint.index`. Đã probe trên Postgres 18.6 trước khi viết `uniqueConstraintOf()`. Map theo tên constraint: `users_email_key` ⇒ `EmailAlreadyExistsError`, `workspaces_slug_key` / `projects_workspace_id_key_prefix_key` ⇒ `RESOURCE_CONFLICT` kèm field, `workspace_members_workspace_id_user_id_key` ⇒ `already_member`.
- **`PrismaUnitOfWork` (A) không nhận `PrismaClient` thật về mặt type:** `$transaction` là hàm overload nên không gán được vào `TransactionCapable`. Runtime đúng; test kit dùng cast có chú thích. **Composition root (main.ts) sẽ gặp đúng chỗ này** — đề xuất A chỉnh type `TransactionCapable`.
- **`pg_advisory_xact_lock` trả `void`:** `$queryRaw` không giải mã được (`UnsupportedNativeDataType`) ⇒ phải dùng `$executeRaw`.

## Bảng truy vết case tầng I (test-spec-auth-workspace.md) → test

| Case | Test |
|---|---|
| REF-06 (refresh đồng thời ×20) | `auth/auth-concurrency.int.ts` |
| REG-03 (email trùng đồng thời — unique constraint), REG-15/SEC-40 (cùng họ tên ⇒ slug khác) | `auth/auth-concurrency.int.ts` (provisioner Workspace thật, cùng transaction) |
| ALL-05 (SET NX vs SET), TTL, store chết | `auth/auth-valkey.int.ts` |
| SEC-24 (Valkey chết khi đọc ⇒ fallback DB), **SEC-24b** (chết khi ghi ⇒ 503, DB không đổi) | `auth/auth-valkey.int.ts` |
| **SEC-23b** login ‖ change-password ×20, **SEC-21c** login ‖ logout-all ×20 (A4) | `auth/auth-races.int.ts` |
| ROL-05 ×20, REM-07a/b ×20 (LAST_OWNER, không deadlock) | `workspace/workspace-races.int.ts` |
| ROL-07 ×20 (assign FOR SHARE ‖ hạ VIEWER) | `workspace/workspace-races.int.ts` (phía assign + cleaner là bản SQL tối thiểu trong `task-fixtures.ts` vì T-018 chưa merge) |
| WSR-05 ×20 (restore ‖ purge) | `workspace/workspace-races.int.ts` |
| MLS-03 (ký tự đại diện), REM-08, WSD-06 (mức repo) | `workspace/workspace-adapters.int.ts` |
| Cấp số đồng thời ×20, project archived/∉ ws/ws xóa ⇒ null; `roleOf`; purger (cascade, advisory lock, purge_at chưa tới) | `workspace/workspace-adapters.int.ts` |
| WSC-03, WSU-03, PRJ-03/04, MEM-06 (unique thật), WSL-02, MLS-01/02, … (mọi case "mức U" của use case) | LSP: `lsp/*.lsp.int.ts` — cùng file test unit, chạy trên Postgres |
| Contract port (QA B.4 P1/P2) | `auth/auth-contracts.int.ts` (Prisma + Valkey) và `in-memory.contract.test.ts` (InMemory) — cùng `testing/contracts/*` |
| Case cần HTTP/route (401, 404 chuẩn qua route, rate limit, WSR-07, WSD-07 socket) | **Ngoài phạm vi T-020** (ticket loại routes) — để ticket HTTP/QA |

**Sửa spec:** REM-07a cũ ("Alice hạ Olga + Olga tự rời") không bao giờ về 0 OWNER nên không kiểm được luật. Đổi thành "Alice hạ Olga + **Alice** tự rời" — biến thể nguy hiểm thật (test-spec đã sửa).

### QA §B.4 (auth) — các [GAP] đã có test

| Vị trí | Test |
|---|---|
| `toClaims`: `sid` rỗng / số, `sub` rỗng, `jti` rỗng, `tv` 1.5 / `'1'`, `iat` không phải số | `jose-access-token-claims.test.ts` |
| `isSessionRevoked`, `getTokenVersion` (user xóa), SET NX, add trùng hash, `revokeFamily` không thu hồi lại | `testing/contracts/*` (InMemory + Prisma/Valkey) |
| Login rehash thật sự được lưu (+ không hồi sinh hash cũ khi bị đổi giữa chừng) | `login.use-case.test.ts` |
| Register: conflict khác `slug` ⇒ ném ngay, không thử lại | `register.use-case.test.ts` |
| Regex Bearer (`xBearer`, thừa phần, thiếu token) không gọi `verify`; `bearer   tok` qua | `access-token-authenticator.test.ts` |
| `needsRehash` theo `parallelism` / `outputLen`; regex hash có neo; secret đúng 32 byte | `argon2id-password-hasher.test.ts`, `crypto-refresh-token-factory.test.ts`, `jose-access-token-service.test.ts` |
| Email `a@b.c@d.e`, `equals` false, biên phần local 3/2 ký tự, `userAgent` undefined, getter `tokenHash` | `email.test.ts`, `password-policy.test.ts`, `refresh-token.test.ts` |

## Definition of Done

Worktree, Windows, Node 24.18.0, pnpm 11.28.2.
- **DB test:** `taskflow_t020` trên postgres-test 5434 (ADR-106).
- **Valkey:** 6380 DB index **12**, khóa ngẫu nhiên `t020-*`, **không `flushDb`**.

Chạy **tuần tự, kiểm exit code từng lệnh**, sau khi rebase lên main `adea03a` và wire composition:

```
$ pnpm typecheck  → exit 0
$ pnpm lint       → exit 0 (prettier ✔ · eslint ✔ · depcruise ✔)
$ pnpm test       → exit 0 · Test Files 109 passed (109) · Tests 1143 passed (1143)
$ DATABASE_URL_TEST=…/taskflow_t020 VALKEY_URL_TEST=redis://127.0.0.1:6380/12 pnpm --filter @taskflow/api test:integration
                  → exit 0 · Test Files 23 passed (23) · Tests 213 passed (213)
```

**Ghi chú trung thực:**
- **Lần chạy `pnpm test` đầu tiên exit 1.** Mọi test có chạy đều qua (82/82 file). Exit 1 đến từ 27 lỗi `vitest-pool: Timeout waiting for worker to respond` khi khởi động worker cho test `apps/web`: máy quá tải, import chiếm 79% thời gian, chạy liền sau typecheck và lint. Branch này không đổi `apps/web`.
- **Chạy lại riêng `pnpm test` ⇒ exit 0** (số liệu trên).
- **Đề xuất D:** cân nhắc `poolOptions` / `teardownTimeout` hoặc giới hạn worker cho web trên Windows.

Không có thao tác nào vượt chặn `migrate reset`. Global setup chỉ DROP/CREATE schema `public` của **DB riêng** `taskflow_t020`.

## Hạ tầng test — ghi lại theo yêu cầu

- **Container tạm `t020-pg` (5436), `t020-valkey` (6381)** — chỉ bind 127.0.0.1, không volume, mật khẩu test. Dùng trước khi có compose của D.
  - Lần chạy đầy đủ trên container tạm: 181/183 qua. 2 lỗi do timeout / `maxWait` trên máy bận, đã sửa: `maxWait: 60s` cho test UoW, timeout riêng cho test race.
  - Sau đó chuyển sang postgres-test + DB riêng theo ADR-106. Đã dừng 2 container tạm.
- Phát hiện: test Valkey ban đầu gọi `flushDb()` — **nguy hiểm trên Valkey dùng chung**. Chỉ từng chạy trên container riêng 6381. Đã bỏ hẳn, dùng khóa ngẫu nhiên + DB index riêng.
- `pnpm install` trong git worktree fail ở `prepare` (`lefthook install` khi `.git` là file). Deps vẫn đủ, hook chạy từ `.git/hooks` chung. Tech Lead đã giao D (T-022).
- Không chạy `pnpm typecheck` song song với `test:integration`: script integration chạy `prisma generate` ghi lại `src/generated` ⇒ `tsc` đọc dở (lỗi giả) và trên Windows `generate` có thể lỗi khóa file.

## Quyết định tự đưa ra

1. Test UoW (`RecordingUnitOfWork`) bọc `PrismaUnitOfWork` thật, ghi `steps` / `commits` / `rollbacks` như `FakeUnitOfWork` để bộ test use case chạy nguyên văn.
2. **Mỗi file test gốc một file runner LSP.** Gộp nhiều file vào một runner làm `beforeEach` cấp file của file này chạy cho test của file kia (đã thấy lỗi thật). Đăng ký `beforeEach(resetDatabase)` trước, rồi `await import()` file test.
3. Purge giữ một transaction mỗi workspace (xóa theo lô trong transaction đó) — đơn giản, idempotent. Nếu workspace rất lớn cần chia nhiều transaction thì là ticket sau.
4. `uniqueConstraintOf` nhân bản ở auth và workspace (module không import runtime lẫn nhau). Ứng viên đưa vào core.

## Rủi ro / việc tiếp

- **C (T-023):**
  - đổi bản sao cục bộ `IAssigneeDirectory` / `ITaskProjectStore` / `IUserRefReader` sang `import type` từ `modules/task` khi T-018 có trên main;
  - có thể đổi ROL-07 sang cleaner thật để chứng minh cả audit.
- **Cổng bảo mật qua HTTP (quyết định Tech Lead):**
  - **Bắt buộc cho T-020:** SEC-21c, SEC-23b, SEC-24c chạy qua HTTP (`test/security/auth.sec.ts`) trên Prisma + Valkey thật, lặp nhiều lần, xanh ổn định.
  - **Kết quả (F chạy, `9b466c0` + T-017c, `taskflow_sec`, Valkey db 15):**
    - **ĐẠT:** 21c / 23b / 24c xanh 10/10 lần chạy (×20 vòng = 200/200 vòng mỗi case), mọi lần exit 0.
    - **Probe thêm:** xóa Valkey sau race để ép đọc DB (40 vòng/case × 6 lần) ⇒ không có lost update `tv` / `passwordHash`.
  - **Nhánh change-password thua race ⇒ 400** không xảy ra qua HTTP (120/120 vòng đều 200):
    - login chỉ ghi `password_hash` khi cần rehash, nên race login ‖ change-password thông thường không làm change thua;
    - nhánh này đã có test xác định ở tầng use case (`change-password.use-case.test.ts`, ca "ADR-104: mật khẩu bị đổi … giữa lúc verify và UPDATE"), chạy lại trên Postgres qua LSP;
    - F sẽ sửa SEC-23b (T-017c) để kiểm trạng thái cuối theo từng nhánh, không ép `change = 200`.
  - **SEC-24b được chấp nhận ở tầng I** cho DONE T-020. `auth-valkey.int.ts` kiểm đúng hành vi cần chứng minh trên hạ tầng thật: Valkey chết khi ghi ⇒ 503 + rollback, `tv` / mật khẩu trong DB không đổi. Bản qua HTTP chỉ thêm lớp vận chuyển.
  - **Bản HTTP của SEC-24b** là follow-up của F (T-017c, cần container Valkey riêng do suite tự tạo/hủy). **Không chặn chuỗi merge.**
- **A:** type `TransactionCapable` vs `PrismaClient` (xem trên). `createPrismaPersistence` đang cast có chú thích; bỏ cast khi core sửa type.
- **Job purge chưa được wire** vào process nào (scheduler/worker). `PrismaWorkspacePurger` đã có + test tầng I, nhưng chưa có gì gọi định kỳ — ticket sau.
- **D2 (ẩn danh hóa user) chưa có lệnh soft-delete.** Khi làm phải tăng `token_version` + thu hồi token trong cùng transaction, và gọi `#reflect` ở `MirroringUserRepository` (TODO đã ghi).
