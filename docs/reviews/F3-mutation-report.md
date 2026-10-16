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
| workspace-domain | 243 | 216 | 0 | 27 | **88.89%** | (mới) | 6m24s |
| workspace-application | 555 | 458 | 0 | 97 | **82.52%** | (mới) | 11m13s |
| workspace-infrastructure (jobs) | 11 | 1 | 0 | 10 | **9.09%** | (mới) | 20s |
| workspace-presentation | 148 | 102 | 18 | 28 | **81.08%** | (mới) | 15m30s |
| **workspace** | **957** | **777** | **18** | **162** | **83.07%** | — | ~33 phút |
| task-domain | 263 | 221 | 0 | 42 | **84.03%** | (mới) | 4m03s |
| task-application | 587 | 477 | 7 | 103 | **82.45%** | (mới) | 10m49s |
| task-infrastructure (rank) | 22 | 19 | 0 | 3 | **86.36%** | (mới) | 25s |
| task-presentation | 104 | 78 | 13 | 13 | **87.50%** | (mới) | 9m21s |
| **task** | **976** | **795** | **20** | **161** | **83.50%** | — | ~25 phút |

Workspace/task chạy trên main 4ba066b (2026-10-16 16:20), concurrency 2, cả 8 nhóm exit 0. Lượt đầu bị dừng giữa chừng để nhường máy cho D build image, sau đó chạy lại từ đầu.

**Chạy lại có mục tiêu sau test của B** (B-1..B-12, main 4ba066b): đột biến 9 file `login`, `logout-all`, `change-password`, `update-me` use case, `access-token-authenticator`, `auth.controller`, `auth.routes`, `refresh-cookie`, `argon2id-password-hasher`, với test `src/modules/auth` + `test/http`. Kết quả: exit 0, 362 mutant, 338 killed / 10 timeout / 14 sống ⇒ **96.13%**. **Cả 20 mutant [GAP] của §3 đã bị giết.** 14 mutant còn sống đúng là các mục [EQ]/[LOW] đã phân loại ở §3 (log/thông điệp, `noStore` phòng thủ kép, `''` mặc định, `eq <= 0`, `#findUser`).

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

Phân loại đọc mã nguồn và test tại 4ba066b. Thêm nhãn **[INT]**: hành vi chỉ được integration test phủ, mà integration không chạy cho từng mutant. Các mục có dấu ✔ đã được F tự đối chiếu mã lần hai.

**Lưu ý cấu hình Stryker:** nhóm `*-application` chỉ chạy `src/modules/<module>`, không gồm `test/http`. Một số [GAP] P3 về `details` của lỗi (W-21, W-22, T-22, T-23) có thể đã được HTTP test bắt nếu được chạy. Các runner `test/integration/lsp/*` chỉ chạy lại đúng unit test trên Postgres, nên không lấp được GAP nào ở đây.

### 4.1 Workspace gửi **Engineer B**: 162 sống = GAP 95 · EQ 42 · LOW 19 · INT 6

Theo nhóm: domain 27 = 12/9/6/0 · application 97 = 71/16/10/0 · infrastructure 10 = 0/2/2/6 · presentation 28 = 12/15/1/0 (GAP/EQ/LOW/INT).

#### [GAP]

| # | Ưu tiên | Vị trí | Đột biến sống | Vì sao test không bắt | Test đề xuất |
|---|---|---|---|---|---|
| W-1 ✔ | **P1** (RBAC, X6) | `application/use-cases/add-member.use-case.ts:65` | `!canGrant(fresh.role, role)` → `false` | Kiểm đầu (`:52`) dùng role CŨ của actor; sau `lockOwnersAndReloadActor`, chỉ dòng 65 chặn. `members-stale-actor.test.ts` chỉ hạ xuống MEMBER/VIEWER (đã bị `requirePermission` chặn trước). Không có ca **OWNER bị hạ xuống PM** rồi cấp OWNER/PM ⇒ regress thành **leo thang quyền** | `givenWorkspaceA(h,{Olga:'OWNER'})`, hạ olga→PM trong store, `AddMember(ctx.olga /*role cũ OWNER*/, {email:nina, role:'OWNER'})` (và `'PM'`) ⇒ `ForbiddenError`, nina không thành member |
| W-2 | P2 | `create-project.use-case.ts:35` | `description ?? null` → `&& null` | Không test nào tạo project **có** description | `CreateProject(pam,{name:'W',keyPrefix:'WEB',description:'Mô tả'})` ⇒ `view.description === 'Mô tả'`, cả trong store |
| W-3 | P2 | `set-project-archived.use-case.ts:47, 50` | `'project:updated'` → `""`; meta `{}`; `originClientId ?? null` → `&& null` | `project-updated-event.test.ts` chỉ đếm số lần emit + `isArchived` | archive với `originClientId:'tab-1'` ⇒ `type === 'project:updated'`, meta `{actorId: pam, originClientId:'tab-1'}` |
| W-4 | P2 | `change-member-role.use-case.ts:66` | `originClientId ?? null` → `&& null` | Test chỉ dùng `originClientId:null` | đổi role với `'tab-9'` ⇒ `notifyRoleChanged` nhận `{actorId, originClientId:'tab-9'}` |
| W-5 | P2 | `create-workspace.use-case.ts:30, 31`; `workspace-creator.ts:20` | catch nuốt mọi lỗi / coi mọi lỗi là trùng slug ⇒ thử lại 5 lần rồi 500 giả | WSC-09 chỉ test trùng slug thật | `createWithOwner` reject `Error('db')`, và reject `ResourceConflictError({reason:'already_member'})` ⇒ reject **đúng lỗi đó**, chỉ gọi 1 lần. (`auth/register.use-case.ts:43` có bản sao `isSlugConflict`) |
| W-6 | P2 | `restore-workspace.use-case.ts:30` | `!ws \|\| !ws.isDeleted` → `&&` ⇒ wsId không tồn tại gây TypeError 500 | WSR-02 dùng **user** lạ, chưa có workspaceId không tồn tại (route restore không qua `loadMembership`) | `restore({userId: alice, workspaceId: randomUUID()})` ⇒ `ResourceNotFoundError {resource:'workspace'}` |
| W-7 | P2 | `optimistic-save.ts:27` | `!current` → `false` ⇒ TypeError 500 thay vì 404 | X8 không có ca project biến mất giữa đọc và ghi | `interleaveProject` chen thao tác xóa project ⇒ `UpdateProject` reject `ResourceNotFoundError {resource:'project'}` |
| W-8 | P2 | `domain/project.ts:83` (getter `version`) | trả `undefined` ⇒ `VersionConflictError.details.currentVersion` undefined | X8 chỉ `toBeInstanceOf`; FE dùng `currentVersion` để hòa giải | thêm `expect(err.details).toMatchObject({ currentVersion: <version hiện tại> })` |
| W-9 | P2 | `workspace.queries.ts:29` | map → `() => undefined` | Test "list của tôi" chỉ assert `[]` | user có ws đang hoạt động ⇒ `toEqual([{id, name, slug, myRole:'OWNER', createdAt, updatedAt}])` |
| W-10 | P2 | `presentation/workspace.routes.ts:71, 82, 96, 109, 114, 120` | bỏ schema validate (`UpdateWorkspaceBody`, `WorkspaceParams` của restore, `AddMemberBody`, `ListProjectsQuery`, `CreateProjectBody`, `UpdateProjectBody`) | test/http chỉ gửi body hợp lệ hoặc bị chặn 403/404 trước. **`workspace.http.test.ts:175-178` có cursor dự phòng hardcode che mất việc `GET /projects?limit=1` hỏng** | OWNER `PATCH /:ws {name:123}` và `{name:'x', deletedAt:null}` ⇒ 400; `POST /not-a-uuid/restore` ⇒ 400; `POST members {email:'abc'}` ⇒ 400; `GET projects?limit=1` ⇒ 200 + `meta.page.limit === 1` (**bỏ fallback**); `POST projects {…, workspaceId}` ⇒ 400; `PATCH project {keyPrefix:'NEW'}` ⇒ 400 |
| W-11 | P2 | `project.controller.ts:49, 52`; `workspace.routes.ts:117` | handler GET project rỗng / `{projectId}` → `{}` / `permit('project:read')` → `permit('')` | **Không test/http nào gọi thành công `GET /workspaces/:ws/projects/:id`**; test IDOR dừng ở 404 | VIEWER/MEMBER `GET …/projects/:id` của chính ws ⇒ 200, body khớp `ProjectDto` đúng id |
| W-12 | P3 | `domain/names.ts:54` | `.replace(/-+$/g,'')` → chuỗi khác | Test "cắt ≤ 40" (`names.test.ts:52`) không cắt trúng dấu "-" (comment trong test sai) | `slugifyName('a'.repeat(39) + ' bcd')` ⇒ `'a'.repeat(39)` |
| W-13 | P3 | `project.ts:25`; `list-members.query.ts:11 (×2), 29`; `slug-rules.ts:47` | biên `>` → `>=`, `<` → `<=` | Test chỉ thử 2001, limit 0/3/101, q 101, base 2 ký tự | description đúng 2000 ⇒ ok; limit 1 và 100 ⇒ ok; q đúng 100 ⇒ ok; `generateSlug('Abc', 0, …)` ⇒ `'abc'` |
| W-14 | P3 | `change-member-role.use-case.ts:46` (×2) | `role !== 'OWNER'` → `true` | Không có ca OWNER duy nhất tự đặt lại OWNER (no-op) | `ChangeRole(alice, {userId: alice, role:'OWNER'})` ⇒ thành công, không LAST_OWNER |
| W-15 | P3 | `change-member-role.use-case.ts:48` | `!user` → `false` ⇒ TypeError | Không có ca membership còn nhưng user mất | xóa user khỏi directory rồi đổi role ⇒ `ResourceNotFoundError {resource:'user'}` |
| W-16 | P3 | `delete-workspace.use-case.ts:43` (×2), `update-workspace.use-case.ts:36` (×2), `workspace.queries.ts:40` (×2) | `!ws \|\| ws.isDeleted` → `false` / `&&` | WSD-05 xóa lại với đúng slug ⇒ `saveWorkspaceOrFail` vẫn 404 nên che mất check | ws đã xóa: Delete với `confirmSlug` sai ⇒ 404 (không phải 400); Update ⇒ 404; `GetWorkspaceQuery` ⇒ 404 |
| W-17 | P3 (log bảo mật) | `update-workspace.use-case.ts:39` | `input.slug !== ws.slug` → `true` | Không có ca PATCH với slug giữ nguyên | PATCH `{slug: <slug hiện tại>}` ⇒ không log `workspace.slug_changed` |
| W-18 | P3 | `adapters/project-access-checker.ts:39` | `instanceof ResourceNotFoundError` → `true` (lỗi DB bị nuốt thành `false`) | Test chỉ dùng in-memory | repo reject `Error('db')` ⇒ `canAccessProject` reject |
| W-19 | P3 | `workspace.routes.ts:61, 76, 101` | bỏ `ListWorkspacesQuery`, `DeleteWorkspaceBody`, `ChangeMemberRoleBody` | Use case vẫn ra 400 hoặc tương tự, chỉ khác tính strict | `GET /workspaces?deleted=yes` ⇒ 400; DELETE body `{}` ⇒ 400 có issue `confirmSlug`; PATCH member `{role:'PM', x:1}` ⇒ 400 |
| W-20 | P3 (hợp đồng lỗi) | `details.issues` của ValidationError (38 mutant): `names.ts:30-33`; `'name'` ở `project.ts:62, 93`, `workspace.ts:29, 70`, `create-workspace:22`; `add-member:27-28`; `delete-workspace:45-46`; `list-members:12-13, 30-31`; `update-project:45-46`; `update-workspace:30-31` | issues `[]`/`{}`/path/code bị làm rỗng | Test chỉ `toBeInstanceOf` / status 400 | dùng helper `codes()` như `names.test.ts`: `['slug:invalid_format']`, `['role:invalid_value']`, `['confirmSlug:mismatch']`, `['limit:too_big']`, `['q:too_big']`, `['name:…']` |
| W-21 | P3 (hợp đồng lỗi) | `details.resource` của ResourceNotFoundError (10): `optimistic-save:17, 27`; `change-member-role:48`; `delete:43`; `owner-guard:39`; `project.queries:36`; `restore:35`; `set-project-archived:36`; `update-workspace:36`; `workspace.queries:40` | `'workspace'`/`'project'`/`'user'` → `""` | Chỉ vài đường kiểm details | thêm `expect(err.details).toEqual({resource:'…'})` vào X2, stale-actor, WSR-05, PRJ-404… |
| W-22 | P3 (hợp đồng lỗi) | `details.required` của ForbiddenError: `add-member:52, 65`; `remove-member:52` | `'member:add'`/`'member:remove'` → `""` | MEM-03 chỉ kiểm 403 | assert `details = {required:'member:add'}` / `{required:'member:remove'}` |

#### [INT]: TL đánh dấu ưu tiên

| Vị trí | Đột biến | Phủ ở |
|---|---|---|
| `infrastructure/jobs/exclusive-purge-run.ts:32, 33, 35 (×4)` | khóa lô không lấy / luôn bận / không bao giờ bận / purge trả undefined | Chỉ `test/integration/maintenance/purge-job.int.ts` ("2 instance cùng chạy ⇒ không bao giờ 2 lô song song…"). **Không có unit test nào** cho file này (unit chỉ import `PurgeRunBusyError`), nên nhóm đạt 9.09%. **GAP ưu tiên cho B (TL):** unit test với fake `DbProvider.$queryRaw`: `[{locked:false}]` ⇒ reject `PurgeRunBusyError`, không gọi inner; `[{locked:true}]` ⇒ gọi inner đúng 1 lần với `(id, now)` |

#### [EQ]

| Vị trí | Lý do |
|---|---|
| `presentation/keyset-cursor.ts:4, 13, 14-15` (10) ✔ | **Lớp dư**: `afterFromCursor` (`core/http/pagination.ts`, `AfterKey = z.object({after: z.uuid()})`) đã từ chối mọi `after` không phải uuid, và `z.uuid()` chặt hơn regex nên nhánh `throw` không bao giờ chạy. Đề xuất cho B: xóa helper hoặc ghi rõ là lớp dự phòng |
| `names.ts:52` (×2), `:54` regex `-+$` → `-$` | `[^a-z0-9]+` → `-` đã gộp, không bao giờ có ≥ 2 dấu "-" liền nhau |
| `membership.ts:52`, `workspace.ts:44, 53, 62, 65` (getter) | Getter không dùng ở production (view/repo dùng snapshot) |
| `membership.ts:43` (getter `workspaceId`) | Chỉ dùng ở hạ tầng in-memory |
| `workspace-provisioner.ts:13` (×2 trim) | `fullName` đã trim ở `User`, `Workspace.create` trim lại |
| `slug-rules.ts:36` `?? '0'` | `random.int(0, 36)` luôn nằm trong alphabet |
| `add-member.use-case.ts:22, 63`; `owner-guard.ts:41` (×2) | Hai lớp dư lẫn nhau (`requirePermission` hoặc `canGrant`), mỗi mutant đơn lẻ không đổi hành vi |
| `list-members.query.ts:34` (×2), `workspace.controller.ts:97` | `''` và `null`/`undefined` cho cùng kết quả |
| `project.queries.ts:21` `'false'` → `''` | Repo xử lý `''` như `'false'`, route luôn đặt default |
| `restore-workspace.use-case.ts:30` (→ `false`), `:38` (×2) | ws chưa xóa có `purgeAt = null` ⇒ vẫn 404; `:38` không thể xảy ra trong cùng transaction |
| `workspace-creator.ts:20` OptionalChaining | `ResourceConflictError` luôn có `details` |
| `workspace-shared.ts:83` (×2) | Bất biến `softDelete` đặt cả `deletedAt` lẫn `purgeAt` |
| `exclusive-purge-run.ts:9` key `''`, `:35` `row?.` → `row.` | Hằng số chung nào cũng loại trừ như nhau; `SELECT` luôn trả 1 dòng |
| `presentation/membership.ts:53`, `workspace.routes.ts:58` → `true`, `:61, 63` `'/'` → `''` | Guard wiring; `validate({})` no-op; Express 5 khớp `''` với `/` |

#### [LOW]
Thông điệp lỗi: `names.ts:17, 18, 19, 34`; `project.ts:27, 55`; `add-member:28`; `create-workspace:34`; `delete-workspace:46`; `list-members:13, 31`; `owner-guard:7`; `update-project:46`; `update-workspace:31`; `workspace-shared:83`; `exclusive-purge-run.ts:14`; `presentation/membership.ts:53`. Tên lớp lỗi: `exclusive-purge-run.ts:15`. Trường log: `purge-deleted-workspaces.job.ts:55`.

#### Đáng lưu ý (workspace)
1. **Không thấy bug sản phẩm**: mọi mutant sống là test thiếu hoặc mã chết. Nặng nhất là **W-1**, nguy cơ leo thang quyền nếu regress.
2. **Test che lỗi**: `workspace.http.test.ts:175-178` (cursor dự phòng); comment của `names.test.ts:52` sai.
3. **Route chưa từng có test thành công**: `GET /workspaces/:ws/projects/:projectId` (W-11).
4. **Bản sao `isSlugConflict`** ở `auth/register.use-case.ts:43`, dễ lệch nhau.

### 4.2 Task gửi **Engineer A**: 161 sống = GAP 70 · EQ 36 · LOW 51 · INT 4

Theo nhóm: domain 42 = 6/2/34/0 · application 103 = 58/25/16/4 · infrastructure 3 = 1/2/0/0 · presentation 13 = 5/7/1/0 (GAP/EQ/LOW/INT).

#### [GAP]

| # | Ưu tiên | Vị trí | Đột biến sống | Vì sao test không bắt | Test đề xuất |
|---|---|---|---|---|---|
| T-1 ✔ | **P1** (thứ tự cột) | `application/task-rank-rebalancer.ts:67` | `at === -1` → `at === +1` | Mọi test rebalance chèn `moving` ở chỉ số 2; khi đích là chỉ số 1, mutant **đẩy task xuống cuối cột** mà không test nào thấy | TODO có A=`LONG`, B=`LONG+'V'`; X ở IN_PROGRESS rank `a0`. Move X `{status:'TODO', afterId:A}` ⇒ `column('TODO') = [A, X, B]`, mọi rank ≤ 3 ký tự |
| T-2 ✔ | **P1** (ADR-116) | `use-cases/create-task.use-case.ts:41` | `lockColumn(projectId, 'TODO')` → `lockColumn(projectId, '')` | Không test nào kiểm tham số `lockColumn`. Integration CC-RB01 chỉ chạy move ‖ move. Khóa sai cột ⇒ create có thể đọc khóa tạm `~<id>` của rebalance đang chạy ⇒ 500 (lỗi kiểu F1/T-033) | Unit: `vi.spyOn(h.deps.tasks, 'lockColumn')` ⇒ `toHaveBeenCalledWith(P1, 'TODO')`. Integration mới **CC-RB02**: create ‖ move kích hoạt rebalance cột TODO ⇒ không 500, không còn `~`, rank không trùng |
| T-3 | P2 | `move-task.use-case.ts:86–88` (9) | điều kiện `alreadyThere` (R15 no-op) | UC-MV15 dùng rank `a0, a1, a2` liền nhau ⇒ tính lại ra đúng rank cũ | Board có khe: A `a0`, B `a3`, C `a7`: B `afterId:A` ⇒ v1, rank `a3`, 0 audit; A `beforeId:B` ⇒ v1; C `{}` ⇒ v1; X (IN_PROGRESS `a5`) vào TODO sau B ⇒ rank `between('a3','a7')`, không giữ `a5` |
| T-4 | P2 | `move-task.use-case.ts:43` | xóa `assertWritable(project)` sau `lockColumn` | Không test archive trong lúc chờ khóa cột ⇒ trả 409 thay vì 422 | stub `lockColumn` archive project rồi gọi hàm gốc ⇒ reject `{statusCode:422, code:'PROJECT_ARCHIVED'}` |
| T-5 | P2 | `task-rank-rebalancer.ts:83` (3) | điều kiện thêm `moving` vào `writes` | Không có ca cùng cột với key ≠ rank cũ, hoặc đổi cột với key trùng | spy `saveRanks`: X cuối TODO rank `a9`, move sau B ⇒ writes không có X; X IN_PROGRESS `a2` vào TODO sau B ⇒ writes không có X |
| T-6 | P2 | `task-rank-rebalancer.ts:52` | `>` → `>=` (ngưỡng MAX) | F2 chỉ dùng MAX+1 task | tổng đúng MAX task ⇒ CÓ rebalance (log `task.rank_rebalanced`), không warn skip |
| T-7 | P2 | `task-rank-rebalancer.ts:165–167` | thân hook `rebalanceEvents` → `{}` / `events` → `undefined` | Không test kiểm `h.events` sau rebalance ⇒ domain event của task bị đổi rank mất mà không ai biết | sau `moveXAfterB` ⇒ đúng 2 `TaskMoved` (B, C) và 1 `TaskStatusChanged` (X) |
| T-8 | P2 | `task-rank-rebalancer.ts:146` (×2), `147` | `userIds`/`refs` rỗng | Test realtime chỉ kiểm `type`, `task.id` | event `task:moved` của C ⇒ `data.task.createdBy = {id: Pam, fullName}`; spy `users.findRefs` không nhận `null` |
| T-9 | P2 | `task-commands.ts:187` | `!current` → `false` ⇒ TypeError 500 thay vì 404 | Unit chỉ có version lệch; CC-DL01 chỉ đi vào nhánh khi race trúng | stub `save` đánh dấu xóa rồi trả kết quả gốc ⇒ `ResourceNotFoundError {resource:'task'}` |
| T-10 | P2 | `create-task.use-case.ts:48, 49` | `description ?? null` → `&& null`; `{priority}` → `{}` | Chưa test create có description / priority khác mặc định | create `{title:'abc', description:'Mô tả', priority:'HIGH'}` ⇒ DTO đúng |
| T-11 | P2 | `task.policy.ts:45` | `assigneeId === null` → `false` | TP-AC chỉ có `undefined`; mutant làm MEMBER gửi `assigneeId:null` bị 403 | `canAssignOnCreate(Mia, null) === true`; MEMBER create `{assigneeId:null}` ⇒ OK |
| T-12 | P2 | `task.queries.ts:49` | `rows.length > limit` → `>=` | UC-LS04 không có trang đúng bằng limit | 5 task, `limit:5` ⇒ `{hasMore:false, nextCursor:null}`; tương tự audit-logs |
| T-13 | P2 (RBAC lớp 2) | `task.queries.ts:115` | xóa `policy.assert(...)` cho đọc | Ma trận cho mọi role `task:read`/`audit:read`; `GET /:taskId` không có cổng ở route ⇒ đây là lớp duy nhất | `TaskQueries` với `TaskPolicy({allows: () => false})` ⇒ getTask/listTasks/listAuditLogs reject `ForbiddenError`, `required` đúng |
| T-14 | P2 | `presentation/task.routes.ts:71, 74, 75, 85, 91` | quyền tối thiểu → `""` ⇒ input sai từ người CÓ quyền nhận 403 thay vì 400 | HTTP mới kiểm 400 cho create/assign/delete của OWNER/PM | `GET ?limit=abc` ⇒ 400; PATCH `/:id {bogus:1}` ⇒ 400; PATCH `/:id/move {bogus:1}` ⇒ 400; Mia DELETE `?expectedVersion=abc` ⇒ 400; audit `?limit=abc` ⇒ 400; VIEWER body sai ⇒ 403 `required` đúng |
| T-15 | P2 | `domain/task-fields.ts:12` (×2) | bỏ `^` / `$` ở DATE_ONLY | Không test ký tự rác đầu/cuối; Zod ở biên HTTP chặn, lệnh không qua HTTP sẽ lọt | `normalizeDueDate('x2026-01-01')`, `('2026-01-01x')` ⇒ `invalid_format` |
| T-16 | P2 | `task-fields.ts:53` | kiểm ngày có thật (`&&`, vế tháng → false) | `2026-02-30` lệch cả tháng lẫn ngày | `'2026-13-01'`, `'2026-00-10'` ⇒ `invalid_format` |
| T-17 | P3 | `move-task.use-case.ts:49` | `>` → `>=` (ngưỡng 64) | Không test đúng biên | stub `ranks.between` trả khóa dài 64 ⇒ không rebalance; 65 ⇒ có |
| T-18 | P3 | `task-rank-rebalancer.ts:67` | `at === -1` → `false` | Không có `wanted` lớn hơn mọi rank | gọi trực tiếp `rebalance({wanted:'zz…'})` ⇒ `moving` nhận khóa cuối |
| T-19 | P3 | `task-rank-rebalancer.ts:130` | `?? null` → `&& null` (mất requestId trong audit) | UC-CR03 chỉ kiểm `persist` | `requestContext.run({requestId:'req-7'}, moveXAfterB)` ⇒ audit MOVED của B, C có `requestId` |
| T-20 | P3 | `task-commands.ts:184`; `task-rank-rebalancer.ts:119` | `!fresh` → `false` ⇒ TypeError thay vì 404 | Chỉ có test archive, không có project biến mất | `projects.findInWorkspace` trả null ⇒ `ResourceNotFoundError {resource:'project'}` |
| T-21 | P3 | `task-commands.ts:169` (×3) | details `{field:'rank', reason:'RANK_COLLISION'}` → `{}` | Test retry chỉ `toBeInstanceOf` | `toMatchObject({statusCode:409, details:{field:'rank', reason:'RANK_COLLISION'}})` |
| T-22 | P3 | assign:25, create:29, 30, delete:20, move:36, update:26 | `required` của 403 → `""` | Test chỉ `toBeInstanceOf(ForbiddenError)` | assert `details.required` đúng quyền |
| T-23 | P3 | `task-commands.ts:66, 74`; create:38; `task.queries.ts:64, 95, 114` | `details.resource` → `''` | Test use case chỉ instanceOf | UC-MV20/21, UC-CR10, queries thêm `details: {resource}` |
| T-24 | P3 | `create-task.use-case.ts:31` | xóa `assertWritable` | Chỉ thứ tự lỗi đổi | P2 archived + assignee không phải member ⇒ `PROJECT_ARCHIVED` (không phải `ASSIGNEE_NOT_MEMBER`) |
| T-25 | P3 | `move-task.use-case.ts:46` | xóa `assertTransition` | Domain kiểm lại, chỉ thứ tự lỗi đổi | TODO→DONE với `afterId` ở TODO ⇒ `INVALID_STATUS_TRANSITION` (không phải `INVALID_ANCHOR`) |
| T-26 | P3 | `assign-task.use-case.ts:32`; `move-task.use-case.ts:59` | nhánh no-op `return dto` → `{}` ⇒ UPDATE thừa | Không event ⇒ không ai thấy | spy `tasks.save`: assign cùng người / move về chỗ cũ ⇒ save không được gọi |
| T-27 | P3 | `task-fields.ts:54` (×2) | biên năm `<` → `<=`, `>` → `>=` | Chỉ thử 1999, 2101 | `'2000-01-01'`, `'2100-12-31'` ⇒ hợp lệ |
| T-28 | P3 | `infrastructure/rank/fractional-index-rank-generator.ts:17` | `[]` → `["Stryker was here"]` | `spread` chưa có test riêng | `spread(0)` ⇒ `[]`; `spread(3)` ⇒ 3 khóa tăng, không trùng |

#### [INT]

| Vị trí | Đột biến | Phủ ở |
|---|---|---|
| `task-dto.ts:42` (×2); `task-rank-rebalancer.ts:147` (filter bỏ / `id !== null` → true) | `findRefs` nhận `null` | InMemory bỏ qua null; `PrismaUserRefReader` (`findMany({id:{in:[…, null]}})`) nhiều khả năng lỗi ⇒ các runner LSP (`test/integration/lsp/task.create-task…`, `task.rank-rebalance.lsp.int.ts`) bắt. Nên thêm spy unit như T-8 |

#### [EQ]

| Vị trí | Lý do |
|---|---|
| `domain/task.ts:73` (getter `number`) | Không dùng ở production (mã chết) |
| `task-fields.ts:53` (vế ngày) | Ngày tràn luôn làm lệch tháng |
| `move-task.use-case.ts:87, 88` `<=` | Rank unique trong cột |
| `task-rank-rebalancer.ts:65` `<=` | `wanted` nằm hẳn giữa hai hàng xóm |
| `task-rank-rebalancer.ts:154`; `task-commands.ts:146`; `task-realtime.ts:19` | Message/event rỗng không xảy ra |
| `move-task.use-case.ts:37` | Dòng 43 kiểm lại trước 409 |
| `update-task.use-case.ts:19–22` (×4) | `normalizeChanges` bỏ `undefined` lần nữa |
| `'save'` → `""` (assign:36, delete:28, move:62, update:32, cleaner:43) | `persist` chỉ phân nhánh theo `'add'` |
| `assign-task.use-case.ts:27` | Assignee hiện tại luôn assignable (ADR-093) |
| `task.policy.ts:25, 38` | `null === userId` chặn ngay sau |
| `task-assignment-cleaner.ts:25, 31, 33` | Chỉ cache / cả hai đều rollback 500 |
| `task-dto.ts:16`; `task.queries.ts:29, 30` | `refs.get(null) ?? null`; cursor opaque, `kind` vẫn khác |
| `fractional-index-rank-generator.ts:10, 17 (n===0)` | Thư viện tự ném / trả `[]` |
| `task-membership.ts:50, 73, 95–97`; `task.routes.ts:71, 72` `'/'` | Tham số luôn truyền / guard wiring / cờ `defineProperty` / Express khớp `''` |

#### [LOW] (51)
Domain 34: `rank.ts:12–13`; `task-errors.ts:7–8`; `task-fields.ts:21, 24, 27, 37, 40, 49, 55, 63`; `task.ts:171–172` (code/message/path của ValidationError, Zod ở biên chặn trước). Application 16: `task-repository.port.ts:76–77`; cleaner:32; `task-commands.ts:88, 166, 195`; move:21; rebalancer:54, 57, 104, 157–169 (log của nhánh best-effort). Presentation 1: `task-membership.ts:73`.

#### Đáng lưu ý (task)
1. **T-2**: khóa cột của create là chốt duy nhất giữ create không đọc khóa tạm `~<id>` của rebalance (ADR-116), mà không có test nào kiểm, kể cả integration ⇒ cần CC-RB02.
2. **T-1**: rebalance chèn sai chỗ một cách lặng lẽ.
3. **T-13**: RBAC lớp 2 cho đọc không test được với ma trận hiện tại.
4. **Mã chết**: getter `Task.number`, nhánh `!main` của `realtimeMessageOf`, `checkTask = true` mặc định, `n === 0` trong `spread`. Nên xóa hoặc đổi thành assert.
5. Không thấy bug sản phẩm chắc chắn.

## 5. Cổng chen trong phiên

| Cổng | Snapshot | Lệnh | Kết quả |
|---|---|---|---|
| E5 (E — `feat/E-layout-g2` @ 96a67aa) | 8367e04 = main fc75215 + merge 96a67aa (worktree riêng của F trên C:) | `next build` (prod, BUILD_ID `u5tQNmNdQQrueXs24vch_`) + `E2E_MOBILE=1 playwright test` | **exit 0: 41 passed / 0 failed / 1 skipped** (E2E-16, fixme thuộc CI), 2.2 phút. E2E-02/03/03b/04 + mobile 412px + axe sáng/tối + SEC-48/48b xanh |

## 6. File

- `apps/api/stryker/*.config.mjs`: 9 nhóm mới, và `auth-infrastructure` loại Prisma/Valkey.
- `apps/api/package.json`: 9 script `mutation:<nhóm>`.
- `docs/tasks/BACKLOG.md`: nhận F3.
- `e2e/scripts/integration-isolation-gate.mjs`: nhận biến `F2_GATE_PG` (gốc kết nối migrator, không kèm tên DB; mặc định giữ postgres-test local 5434). Đây là đề xuất của D (ci-parity-report, "Đề xuất cho điểm 5"), làm script chạy được trên CI. Đã qua `node --check`; chưa chạy lại cổng vì máy đang nhường k6.
- 2026-10-16 (docs/F3-ws-task): §2 thêm kết quả workspace/task + lượt có mục tiêu sau test của B; §4 findings workspace (B) / task (A). BACKLOG: F5 (503 khi Valkey chậm).
- Không sửa `apps/*/src/**`. Mutant kiểm chứng tay sửa tạm 1 file rồi khôi phục.
