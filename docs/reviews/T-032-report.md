# T-032 Report — Đồng thời & phiên: sửa findings đọc chéo của F (auth / workspace)

**Người làm:** Engineer B · **Branch:** `feat/T-032` · **Ngày:** 2026-10-15
**Nguồn:** `docs/reviews/T-028-crossread-F.md` (X1–X9) · ADR-104, **ADR-110**

## Tóm tắt

| ID | Mức | Sửa | Commit | Bằng chứng |
|---|---|---|---|---|
| X2 | Medium | ADR-110: `version` cho Workspace / Project; `save()` = `UPDATE … WHERE id AND version AND chưa xóa` rồi `version + 1`; lệch ⇒ đọc lại: không còn / đã xóa ⇒ 404, còn lại ⇒ 409 `VERSION_CONFLICT` | `562ad00` | race thật ×20 `workspace-version-races.int.ts`; ghi chen giữa (unit + LSP Postgres) `optimistic-save.test.ts` |
| X8 | Low | cùng ADR-110 cho Project (rename ‖ archive không gỡ archive) | `562ad00` | như trên |
| X3 | Medium | cache miss `tv` ⇒ đọc **cả** `tv` lẫn phiên bị thu hồi trong DB; **khôi phục `sid-revoked`** của mọi phiên bị thu hồi trong cửa sổ TTL **trước** khi `SET NX` `tv`; khôi phục lỗi ⇒ không nạp `tv` | `fe479c6` | `session-cache-refill.test.ts`; contract `listRevokedSessionsSince` trên InMemory + Prisma |
| X4 | Medium | refresh khóa dòng user `FOR SHARE` (`lockTokenVersion`) trước khi tạo token kế tiếp | `3db2880` | race thật ×20 `auth-refresh-races.int.ts` — **đỏ khi gỡ bản sửa** (refresh ‖ change-password để lại 2 token sống) |
| X1 | Medium | (làm ở T-028: ADR-109 `__Host-tf_rt` + thu hồi mọi family khi trùng + trần 4 ⇒ 401) | `feat/T-028-task` (đã merge) | cổng ADR-109 của F xanh 3/3 |
| X5 | Low | cursor members / projects: `after` không phải uuid ⇒ 400 `invalid_cursor`; anchor members lọc `workspace_id` | `d0e8d5c` | `cursor-forgery.http.test.ts` |
| X6 | Low | ChangeRole / RemoveMember / AddMember khóa owners trước rồi **đọc lại role của actor**: mất membership ⇒ 404, bị hạ ⇒ kiểm quyền lại | `944d079`, `118a605` | `members-stale-actor.test.ts` (**5/5 đỏ khi gỡ bản sửa**) + LSP Postgres |
| X7 | Low | `assertWorkspaceLive` trong transaction cho thêm / đổi role / xóa thành viên, tạo / sửa / archive project; query Prisma loại ws đã xóa mềm | `8cb311a` | `deleted-workspace-guard.test.ts` + LSP Postgres |
| X9 | Low | sự kiện mới: `member.added`, `workspace.deleted`, `workspace.slug_changed`, `auth.password_change_failed`, `auth.refresh_cookie_ambiguous` (chỉ id / ip, không email / cookie) | `e45e699` | `security-events.test.ts` (2 module), `auth-controller-cookie-events.test.ts` |
| Info | — | `sid-revoked` TTL 905s = 900 + `clockTolerance` 5s của jose | `1c6cd28` | test logout / refresh / refill |

## Quyết định tự đưa ra

1. **ADR-110 dùng version nội bộ:** client không gửi `expectedVersion` cho workspace / project — use case dùng version đã đọc đầu transaction. Hợp đồng API không đổi; chỉ thêm khả năng `409 VERSION_CONFLICT` khi có ghi đồng thời (FE thử lại).
2. **`allocateTaskNumber` không tăng version project** (bộ đếm, không phải sửa của người dùng) — đã thống nhất với C. `save()` project không ghi `next_task_number` (cả hai backend).
3. **X3 rộng hơn đề xuất của F:** chỉ kiểm thêm `sid` khi miss là **chưa đủ** — một phiên khác của cùng user có thể nạp lại `tv` trước, sau đó phiên đã đăng xuất **trúng cache `tv`** và không bao giờ hỏi DB về `sid`. Vì vậy khôi phục `sid-revoked` cùng lúc nạp `tv` (test thứ 2 trong `session-cache-refill.test.ts`).
4. **X6 không dùng `FOR SHARE` trên dòng actor:** dễ deadlock (thứ tự khóa khác nhau giữa các giao dịch). Thay vào đó cả ba use case khóa các dòng OWNER trước (cùng điểm tuần tự hóa của ADR-046), rồi đọc lại membership. Hệ quả: bên thua của ROL-05 / REM-07 giờ có thể bị từ chối bằng `403` / `404` (actor đã bị bên thắng hạ / xóa) thay vì luôn `422 LAST_OWNER` — bất biến không đổi (đúng 1 thành công, ≥ 1 OWNER, không deadlock); test-spec ROL-05 đã cập nhật.
5. **X5 ở tầng presentation workspace:** `AfterKey` dùng chung ở `core/http/pagination.ts` (của A) — đã đề xuất A đổi sang `z.uuid()` ở T-031.
6. **X9 `requestId` / `ip` trên mọi dòng:** chờ mixin request context của A (T-031 mục 8) thay vì truyền `meta` vào từng use case (tránh trùng khóa). Các sự kiện mới có `ip` ở chỗ đã có sẵn (login, đổi mật khẩu, cookie trùng).

## Migration

`apps/api/prisma/migrations/20261016000000_workspace_project_version/migration.sql` — thêm `version INTEGER NOT NULL DEFAULT 1` + `CHECK (version >= 1)` cho `workspaces`, `projects`. Đã báo C: T-023 / T-033 không có migration ⇒ không trùng.

## Sai sót trong lúc làm (ghi lại cho minh bạch)

- `fe479c6` được commit khi `typecheck` đang đỏ (fixture contract, `noUncheckedIndexedAccess`) — hook pre-commit không chạy typecheck. Sửa ở `20839a6`.
- `944d079` (X6) được commit trong khi file race LAST_OWNER đang đỏ (chuỗi lệnh dùng `;`). Sửa ở `118a605`. Từ đó mọi commit nối `typecheck && eslint && commit`.
- Cả hai đều đã xanh trước khi bàn giao (DoD dưới).

## Tài liệu (Tech Lead giao thêm)

- `security.md` §6.4 + SEC-28, `test-spec` LOG-09: theo **ADR-108** (A hiện thực ở T-031) — `login-ip` 20/15 phút trước validate; (IP, email) 10 lần 401/15 phút và email 100 lần 401/giờ **sau** validate, chỉ đếm 401; change-password fail-closed; đoạn giải thích rủi ro còn lại được chấp nhận.
- `security.md` §2.1: `JWT_ACCESS_TTL_SECONDS` (5–900) chỉ khi `APP_ENV=test`.
- `security.md` §2.4: hành vi cache miss của X3; TTL `sid-revoked` 905s.
- `test-spec` ROL-05: bên thua có thể nhận 403 / 404 (X6).

## Definition of Done

Rebase lên main `8d41ff3` (đã có T-023, T-024, T-031, bản sửa test web của E). Chạy tuần tự, `--maxWorkers=2`, kiểm exit code — **lần chạy cuối, tất cả xanh**:

```text
$ pnpm typecheck  → exit 0
$ pnpm lint       → exit 0
$ pnpm test -- --maxWorkers=2
                  → exit 0 · Test Files 146 passed · Tests 1519 passed
$ DATABASE_URL_TEST=…/taskflow_t020 VALKEY_URL_TEST=redis://127.0.0.1:6380/12   pnpm --filter @taskflow/api test:integration -- --maxWorkers=2
                  → exit 0 · Test Files 38 passed · Tests 355 passed
```

**X9 + mixin T-031:** `test/http/security-event-context.http.test.ts` (composition thật) — `auth.login_failed` và `member.added` mang `reqId` = `X-Request-Id` của response và `ip` thật sau trust proxy; không có email. `createTestApp` thêm tùy chọn `logDestination` (mặc định vẫn im lặng).

**Ghi chú trung thực:** trước khi rebase lên main có bản sửa test web, có những lần `pnpm test` exit 1 **chỉ ở `apps/web`** (timeout 5000ms / `Worker forks emitted error` khi máy thiếu tài nguyên; T-032 không đổi file nào trong `apps/web` / `packages`). Tech Lead đã giao E xử lý.

## Việc liên quan người khác

- **A (T-031):** mixin `reqId` + `ip` (X9); `AfterKey.after` ⇒ `z.uuid()`.
- **F:** cổng hộp đen X2 / X8 (40 vòng ⇒ 0 hồi sinh), X5 (cursor ⇒ 400), SEC-24e (restart Valkey ⇒ phiên đã logout vẫn 401) — chạy trên HEAD commit (không phải đường dẫn worktree).
- **Composition (file của A):** `src/composition/task-mirrors.ts` — `save()` trả `boolean`, chỉ phản chiếu khi ghi thật (bắt buộc bởi ADR-110; A đã xác nhận).
- **Report T-028:** tham chiếu sửa của C nên là `d44307a` (hash sau rebase) thay cho `472a398` — nội dung không đổi.
