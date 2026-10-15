# T-024 Report — HTTP cho Task + realtime + test bổ sung từ mutation

Engineer A (`taskflow-enterprise-50`) · 2026-10-15 · Branch `feat/T-024` (worktree `D:\TaskFlow_wt\T-024`, rebase lên `main` @ adea03a)

## Commit
| Commit | Nội dung |
|---|---|
| `test(T-024): close core mutation gaps…` | **Việc 0** (commit riêng): test cho mọi [GAP] P1–P2 (+ P3 rẻ) ở T-017-findings §B.3 |
| `chore(T-024): lint plugins … devDependencies` | Theo yêu cầu D (T-022): 6 plugin lint của `packages/config` → devDependencies (+ lockfile) |
| `feat(T-024): HTTP routes for tasks…` | Route + controller + module Task, wiring composition, test HTTP + realtime |
| `fix(T-024): charset regex lost its escapes…` | **Lỗi thật mutation testing lộ ra** + đợt test 2 cho core-http |
| `docs(T-024): report` | báo cáo này |

## Definition of Done
xem mục "DoD" ở cuối.

## Việc 0 — mutation core (QA F §B.3)

Stryker `mutation:core-http`:

| Lần | Điểm | Ghi chú |
|---|---|---|
| Trước (F, T-017) | **75.32%** | |
| Sau đợt 1 (`9dd573f`) | **78.50%** | phạm vi nhóm nay gồm cả file mới của T-016/T-021 (`pagination.ts`, `request-user.ts` 0% vì chỉ được test ở `test/http`, `rate-limit/store.ts` 67% vì test Valkey bị skip trong sandbox) |
| Sau đợt 2 (`3df637f`) | **99.24%** | 518 killed + 2 timeout / 4 survived (chuỗi thông điệp) |

Test đã thêm (mỗi test ghi đột biến nó giết):
- **P1**: dòng log pino-http chỉ có `req {id, method, url}` / `res {statusCode}` — gửi `Authorization`, `Cookie`, `X-Api-Key` và khẳng định không lọt log; `X-Request-Id` bọc rác trước/sau uuid hoặc chèn CRLF ⇒ sinh id mới; PATCH/PUT với `text/plain` ⇒ 415; **SIGTERM/SIGINT** (process giả) ⇒ shutdown đúng một lần, `exit(0)`, handler tự gỡ.
- **P2**: CORS `Allow-Methods`/`Expose-Headers`/`Max-Age`; JSON gốc nguyên thủy ⇒ 400 (strict); khoảng trắng trước `;`; `Content-Encoding` lạ ⇒ 415; nhánh `headersSent` (handler không log/ghi chồng); log 5xx **không có cause** vẫn kèm lỗi; `throw 'chuỗi'` ở dev ⇒ 500 envelope JSON; cursor là JSON nguyên thủy ⇒ 400; log fatal kèm lỗi gốc; Valkey `disableOfflineQueue` (đang reconnect ⇒ lệnh bị từ chối < 100ms); backoff reconnect (export `valkeyReconnectDelay`: 0→100, 3→800, ≥6→5000).
- **P3 rẻ**: `/readyz` no-store + không rò timer; 2 `validate` liên tiếp; path số của Zod; mức log 2xx/4xx/5xx và biên 399/400/499/500; health không log; `request-context.get()`; event bus không subscriber; biên 30 000ms chống spam log Valkey.
- **Đợt 2** (theo survivor của lần chạy 78.5%): `pagination` (khứ hồi, sai kind ⇒ 400), `request-user` (`X-Client-Id` uuid/bọc rác/mảng, User-Agent cắt 255), `parseContentType` (neo regex, nháy, `utf8`), `requireAllowedOrigin`, mô tả thuộc tính của `validate`, `Retry-After` theo thời gian còn lại, khóa email = SHA-256 chữ thường, `FailModeStore` (localKeys/prefix, resetTime = now + cửa sổ, decrement lỗi chỉ cảnh báo, log kèm rule/lỗi, chặn 30s, closed ⇒ 503), `ResilientRedisStore` với Redis giả (init khi sập không ném; hồi phục; không nạp lại script khi không lỗi).

**Lỗi thật lộ ra**: regex `charset` của A5 (T-021) bị mất dấu `\` khi tôi chèn bằng template string ⇒ thành `/^charsets*=s*"?([^";s]+)"?$/` (`\s` thành chữ `s`): `charset = utf-16le` (có khoảng trắng) hoặc charset chứa chữ `s` lọt qua kiểm tra UTF-8 của API (body-parser vẫn chặn phần lớn). Đã sửa + ca hồi quy.

**Survivor để lại có chủ đích** (TL: time-box, 85% là mục tiêu hướng dẫn): chuỗi thông điệp/log (`cursor.ts:10,15`, `error-handler.ts:34`, `health.ts:23`, message log của store), tương đương (`origin !== undefined` vì `Set.has(undefined)` luôn false; option HSTS/referrerPolicy trùng mặc định helmet 8; `typeof type === 'string'`; `catch {}` rỗng của cursor; `type: 'application/json'` của `express.json` trùng mặc định; `legacyHeaders: false` — header legacy chỉ thêm, không đổi hành vi; `?.` trên giá trị không bao giờ undefined trong luồng gọi). `mutation:core-runtime`: **82.20% (F, T-017) → 88.48%** (165 killed + 4 timeout / 22 survived — phần lớn chuỗi log và mặc định tương đương F đã đánh dấu [EQ]/[LOW]).

## Việc chính

| Mục | File | Ghi chú |
|---|---|---|
| Route + controller | `modules/task/presentation/task.routes.ts`, `task.controller.ts` | Mọi endpoint §2.7 tại `/workspaces/:wsId/projects/:projectId/tasks` (`Router({ mergeParams: true })`), schema contracts, envelope + `meta.page`. Controller chỉ gọi use case/query (ADR-015). `X-Client-Id` hợp lệ ⇒ `scope.clientId` ⇒ `originClientId` của event. |
| Tenant guard 2 lớp (ADR-020) | `task-membership.ts` | Lớp 1: `loadTaskActor` — membership workspace qua `TaskMembershipSource` **tiêm vào** (Workspace `WorkspaceAccess.resolveActor`, khớp cấu trúc, không import nội bộ module). Lớp 2: use case của C kiểm project ∈ ws, task ∈ project ⇒ 404. |
| Thứ tự kiểm | `validateOrForbid` | 401 → 400 params → 404 ws → [body sai: 400 nếu role có quyền tối thiểu, **403** nếu không] → use case 404 project/task → 403 Policy → 422 → 409. Giữ được cả "404 trước 403" (project/task ngoài phạm vi) lẫn "403 trước 400 body" (không lộ luật validate). |
| Realtime | `composition/late-realtime.ts` | **Không cần listener riêng**: use case của C đã dựng payload `task:*` đúng §4.3 (DTO đầy đủ + version, from/to, changedFields) và gọi `ITaskRealtimeNotifier.emitToProject` **sau commit** (`uow.afterCommit`). Domain event không mang DTO/`originClientId` nên listener trên bus sẽ phải đọc lại task — thừa. Tôi chỉ thêm `emitToProject` vào `LateBoundRealtime` (⇒ gateway). Không tạo file trong `modules/task/infrastructure/realtime/` (thư mục của C). |
| Module | `modules/task/task.module.ts` | `createTaskModule` (TaskCommands + 5 use case + queries + `TaskAssignmentCleaner`); `createInMemoryTaskRepositories`. |
| Composition | `composition/container.ts`, `persistence.ts`, `task-mirrors.ts`, `users.ts` | `IRolePermissions` = contracts `ROLE_PERMISSIONS`; membership của Task ← Workspace (tham chiếu trễ một chiều); **cleaner thật của Task thay stub** (`unassignedTaskCount` giờ đúng). Chế độ bộ nhớ: `InMemoryTaskDatabase` giữ bản sao project/member/user/ws-đã-xóa ⇒ decorator phản chiếu mọi lần ghi của Workspace/Auth; DB task vào cùng `InMemoryUnitOfWork` (rollback chung). `users.ts`: thêm tham số `onWrite` cho `MirroringUserRepository` — **đã thống nhất với B** (T-020 giữ nguyên hook). |

## Test
- `test/http/task.http.test.ts` (12): tạo/đọc/list (lọc `assigneeId=none`, cursor), mass assignment ⇒ 400, IDOR (người ngoài ⇒ 404 workspace; project ws khác ⇒ 404 project; task project khác ⇒ 404 task), thứ tự 401/400/404/403 + VIEWER body sai ⇒ 403 vs MEMBER ⇒ 400, `VERSION_CONFLICT` kèm `current`, move + `INVALID_STATUS_TRANSITION` kèm `allowed`, `ASSIGNEE_NOT_MEMBER`, MEMBER gán người khác ⇒ 403 / tự nhận ⇒ ok, xóa theo Policy + audit vẫn đọc được sau xóa mềm, `PROJECT_ARCHIVED`, **xóa thành viên ⇒ task được bỏ gán (cleaner thật)**.
- `test/http/realtime.http.test.ts` (+1): A move task ⇒ B (thành viên, ở phòng project) nhận `task:moved` đúng §4.3 (`actorId`, `originClientId` = X-Client-Id của A, `from/to`, task version 2); C (workspace khác) không vào được phòng và không nhận event.

## Kết quả bộ SEC của QA F (@ 7003b9c, hộp đen spawn `main.ts`, DB `taskflow_sec`)
**70 pass · 1 fail · 5 skip · 38 todo.**
- **TASK — 19/19 PASS**: SEC-02 (URL ws B + project/task của A ⇒ 404 mọi method, DB không đổi), SEC-03, TASK-LIST, SEC-04 (field lạ ⇒ 400, không ghi), SEC-05 (VIEWER 5 thao tác ⇒ 403), SEC-06, SEC-07, SEC-08, SEC-10 (archived ⇒ 422 cho tạo/sửa/move/xóa), SEC-11 (gán người ngoài ⇒ 422 giống uuid lạ), SEC-12/12b/12c, SEC-42 (VIEWER version cũ ⇒ 403, không lộ currentVersion), SEC-43, TASK-VC (409 + no-op version cũ vẫn 409 — ADR-091), **TASK-VC-RACE** (10 PATCH song song ⇒ đúng 1×200, 9×409), **SEC-44** (hạ VIEWER ⇒ bỏ gán + audit), **SEC-45** (race gán ‖ hạ VIEWER ×20).
- Auth/ws vẫn xanh: SEC-01, 18, 21, 21c, 25, 29, 30, 31 (gồm A5), 33, 40, 56, 57, 58, production hardening.
- **FAIL — SEC-23b (đúng-mong-đợi)**: login(mật khẩu cũ) ‖ change-password ⇒ lost update A4 (login đọc user ngoài UoW rồi `save` cả aggregate). Sửa đúng chỗ là ADR-104 (lệnh nguyên tử theo mục đích) ở **T-020 của B**; sau khi rebase lên main có T-020 phải xanh.
- TODO của F: SEC-09 (cần API xóa user), realtime rò sang ws khác (F đang viết).

## Phối hợp / quyết định
1. **Thứ tự merge** T-020 (B) → T-023 (C) → T-024: khi rebase giữ bản của B cho `persistence.ts`, `main.ts`, `users.ts`; nối lại task wiring + `onWrite` (B đã giữ chữ ký) + `LateBoundRealtime.emitToProject`.
2. `packages/config` deps → devDependencies (D): **lưu ý** — pnpm 11 báo "Already up to date" và lockfile vẫn ghi `dependencies` cho tới khi xóa `node_modules/.pnpm-workspace-state-v1.json`; commit có lockfile đã tạo lại.
3. Body sai ⇒ 403 khi không có quyền tối thiểu (`validateOrForbid`) — chỉ ở route Task. Route project của T-021 dùng `permit` trước khi tìm project ⇒ VIEWER PATCH project không tồn tại nhận 403 (không phải 404) — không lộ dữ liệu khác tenant (cùng ws), ghi nhận để TL quyết có cần đồng bộ cách làm.

## DoD (sau rebase lên main @ adea03a; `--maxWorkers=4`, kiểm exit code từng lệnh)
```text
$ pnpm install --frozen-lockfile                                  [exit 0]
$ pnpm typecheck                                                  [exit 0]
$ pnpm lint     api lint:deps ✔ 264 modules, 1078 deps · web ✔ 163 modules   [exit 0]
$ pnpm exec vitest run --maxWorkers=4
  Test Files 110 passed (110) · Tests 1163 passed (1163) · không có "Unhandled Errors"   [exit 0]
$ pnpm build                                                      [exit 0]
$ pnpm --filter @taskflow/api mutation:core-http                  99.24%   [exit 0]
$ pnpm --filter @taskflow/api mutation:core-runtime               88.48%   [exit 0]
```

## Bổ sung sau review — thống nhất thứ tự 404 trước 403 cho route project (quyết định TL)
Route `/workspaces/:wsId/projects/:projectId*` (T-021) giờ tra project bằng `GetProjectQuery` (mọi role có `project:read`) **trước** `permit` ⇒ VIEWER PATCH/archive/unarchive project không tồn tại nhận **404 `project`** (trước đây 403); project có thật ⇒ 403; body sai từ người không có quyền ⇒ 403. Test trong `project.http.test.ts`; kiểm tra đột biến: bỏ bước này ⇒ test đỏ. DoD sau thay đổi: typecheck / lint / **110 file, 1164 test** — exit 0.
