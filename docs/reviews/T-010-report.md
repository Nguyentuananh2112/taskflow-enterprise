# T-010 — Báo cáo: packages/contracts + Prisma schema + migration đầu + seed

**Người làm:** Engineer C (`taskflow-enterprise-d7`, thay phiên `-ba` bị crash) · **Branch:** `feat/T-010` (đã rebase lên `main` @ `1531741`, gồm T-009/T-014)

## 1. Bàn giao sau crash
Commit tạm `9bfd02a` (Tech Lead `git add -A`, chưa review) đã được **review lại toàn bộ** từng file, so với `data-and-api.md`, `security.md` §3.2 và DECISIONS:

| Phần | Kết luận review |
|---|---|
| `schema.prisma` | Trùng khớp từng dòng với khối Prisma ở data-and-api §1.4 (đã `diff`). |
| `migration.sql` | Phần sinh tự động = đúng output `prisma migrate diff --from-empty --to-schema` (chỉ khác dòng `CREATE SCHEMA` mà `migrate dev` vốn bỏ) ⇒ không bị sửa tay. Phần SQL tay tách riêng ở cuối file. |
| `prisma.config.ts` | Đúng ADR-061: `process.env.DATABASE_URL ?? ''`, không `env()`. Nạp `.env` bằng `process.loadEnvFile` có sẵn của Node 24 (không thêm dotenv). |
| Contracts | Đúng §5; ma trận `ROLE_PERMISSIONS` khớp security.md §3.2 từng ô; `TASK_STATUS_TRANSITIONS` khớp §6.1. Có vài thiếu sót — đã sửa (mục 2). |
| Seed, integration test | Cấu trúc đúng; đã bổ sung (mục 2). |
| Purge job trong data-and-api (việc 1) | Đã sửa theo ADR-095 trong commit tạm; tôi kiểm lại: `pg_try_advisory_xact_lock` là câu đầu của **mỗi lô/transaction**, cấm khóa mức session. Giữ nguyên. |

Rebase lên `main` (2 lần — main tiến trong lúc làm) có xung đột với T-009/T-013/T-014 ở `pnpm-workspace.yaml`, `apps/api/package.json` (giữ cả hai bên; `typecheck` = `prisma generate` + `tsc`, giữ `test:coverage` của main) và `pnpm-lock.yaml` (lấy bản của main rồi `pnpm install` sinh lại).

## 2. Đã làm thêm sau review
- **Email**: đổi thứ tự chuẩn hóa thành trim → NFC → lowercase cho khớp security.md §1.1 và value object `Email` của T-013 (bản tạm là trim → lowercase → NFC — lệch nhau ở vài ký tự Unicode hiếm). Thêm test biên 254 ký tự.
- **Subpath exports** (§5.1 có ghi, bản tạm thiếu): `@taskflow/contracts/{common,rbac,auth,workspace,project,task,audit,realtime,system}`; thêm `index.ts` cho các thư mục nhiều file. Test `exports.test.ts` khẳng định mỗi subpath chỉ xuất những gì barrel gốc xuất, cùng tham chiếu. **Không đổi tên export nào** (E/B đang import).
- **Test bổ sung** (`dto.schemas.test.ts`): Register/LoginResponse, WorkspaceDto/DeletedWorkspaceDto, MemberDto + 2 response có `unassignedTaskCount`, ProjectDto, DeleteTaskResponse, mọi `…Details` của §3.2, các event `task:deleted`, `project:updated`, `workspace:access-revoked`, `member:role-changed`, `auth:expired`.
- **Test parity enum Prisma ↔ contracts** (§5.2 yêu cầu): `apps/api/test/prisma-enums.parity.test.ts` — đọc thẳng `schema.prisma` nên chạy trong `pnpm test` mà không cần `prisma generate` hay DB; so cả **thứ tự** (Postgres sắp enum theo thứ tự khai báo, `GET tasks` sắp theo `status`).
- **Seed**: dùng `Argon2idPasswordHasher` thật của T-013 với mật khẩu dev chung `TaskFlow-dev-2026` (đổi được bằng `SEED_PASSWORD`) — bản tạm dùng hash hỏng nên không đăng nhập được, FE/QA không dùng được seed. Đã kiểm: qua `PasswordPolicy` với cả 6 email mẫu và `verify` đúng với hash trong DB. Audit `CREATED` đủ hình dạng §1.5; thêm 1 task xóa mềm (version 2 + audit `DELETED`).
- `data-and-api.md` §5.1: cập nhật danh sách export cho khớp code (`apiSuccess(schema)`, `limitQuery(max, def)`, `locale.ts`, `system/`, các `…Details`).

## 3. File
- `packages/contracts/**` — schema + test (11 file test, 1 fixture).
- `apps/api/prisma/schema.prisma`, `prisma/migrations/20261015000000_init/migration.sql`, `migration_lock.toml`, `prisma/seed.ts`, `apps/api/prisma.config.ts`.
- `docs/design/data-and-api.md` (purge job ADR-095, R19 → ADR-094, §5.1).
- **Ngoài "Phạm vi sở hữu"** (cần để ticket chạy được — xin Tech Lead duyệt):
  - `pnpm-workspace.yaml`: catalog `prisma`, `@prisma/client`, `@prisma/adapter-pg` = **7.10.0** chính xác (ADR-060); `allowBuilds` cho `prisma`, `@prisma/engines`.
  - `apps/api/package.json`: deps trên; script `db:*`, `db:check-drift`, `test:integration`; `typecheck` chạy `prisma generate` trước `tsc` (client sinh vào `src/generated/`, đã gitignore).
  - `apps/api/tsconfig.json`: include `prisma`.
  - `apps/api/vitest.integration.config.ts`, `apps/api/test/integration/*`, `apps/api/test/prisma-enums.parity.test.ts`.
  - `pnpm-lock.yaml`.

## 4. Ràng buộc DB (SQL tay, ADR-062)
`tasks.rank` `COLLATE "C"`; CHECK: `users.email = lower(email)`, `token_version ≥ 0`, slug đúng regex R19 + ≥ 3 ký tự, `(deleted_at IS NULL) = (purge_at IS NULL)` cho workspace, `key_prefix` đúng R17, `next_task_number ≥ 1`, `tasks.number ≥ 1`, `version ≥ 1`, `rank <> ''`. FK kép `tasks(project_id, workspace_id) → projects(id, workspace_id)` và partial unique `tasks_rank_live_key` do Prisma quản lý (native `partialIndexes`). Prisma không mô hình hóa collation/CHECK ⇒ không gây drift (đã kiểm bằng lệnh dưới).

## 5. Definition of Done (chạy trong `D:\TaskFlow_wt\T-010`, sau rebase)
```
$ pnpm typecheck && pnpm lint && pnpm test          # exit 0
apps/api typecheck: ✔ Generated Prisma Client (7.10.0) … Done
apps/api lint:deps: ✔ no dependency violations found (113 modules, 316 dependencies cruised)
apps/web lint:deps: ✔ no dependency violations found (27 modules, 58 dependencies cruised)
 Test Files  44 passed (44)
      Tests  503 passed (503)
```
Integration (Postgres 18.6 tạm, cổng **5433** theo ADR-097 — container `t010-pg`, `postgres:18.6-bookworm`, vì T-011 chưa merge):
```
$ DATABASE_URL_TEST=postgresql://postgres:dev@localhost:5433/taskflow_test pnpm --filter @taskflow/api test:integration
Applying migration `20261015000000_init` … All migrations have been successfully applied.
# test "migrate diff rỗng" chạy:
#   pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
No difference detected.
      Tests  14 passed (14)
```
Kiểm drift tay (cũng là script `db:check-drift`, CI dùng được):
`DATABASE_URL=… pnpm --filter @taskflow/api db:check-drift` ⇒ `No difference detected.`, exit 0.

Seed (`migrate deploy` + `prisma db seed` trên `taskflow_dev`): 6 user, 2 workspace, đủ 4 role (OWNER 2, PM 1, MEMBER 2, VIEWER 2), 2 project (1 archived), 30 task (TODO 8 · IN_PROGRESS 8 · REVIEW 7 · DONE 7, 1 xóa mềm), audit CREATED 30 + DELETED 1.

Integration test phủ: collation C (UC-CR21), thứ tự byte (UC-MV23), partial unique rank (UC-CR22, UC-DL12), unique (project, number) (UC-CR18), FK kép chặn task lệch workspace (UC-CR20), FK Restrict audit→user (UC-AU07), mọi CHECK ở mục 4, partial index purge.

## 6. Quyết định tự đưa ra
1. Mật khẩu dev chung trong seed (repo public — ADR-072): chỉ là dữ liệu giả, seed từ chối chạy khi `NODE_ENV=production`, đổi được qua `SEED_PASSWORD`. Không phải secret thật.
2. Contracts có helper thuần `roleHasPermission(role, perm)` (tra bảng, không có logic Policy) cho FE.
3. Integration test **không** nằm trong `pnpm test` (cần DB) — chạy riêng bằng `test:integration`; `globalSetup` DROP schema `public` của `DATABASE_URL_TEST` và từ chối chạy nếu trùng `DATABASE_URL`. Chiến lược clone DB theo worker (ADR-074) để D làm ở T-011.
4. `auth:expired` cũng dùng vỏ `RealtimeEnvelope` (§4.3 nói "mọi event có chung vỏ"); `actorId` = chính user đó.

## 7. Rủi ro / việc cho người khác
- **D (T-011)**: CI cần job integration với Postgres + bước `db:check-drift`; `apps/api/.env.example` chưa có `DATABASE_URL`/`DATABASE_URL_TEST` (file không thuộc phạm vi tôi).
- `prisma generate` phải chạy trước `tsc`/build (đã gắn vào `typecheck`); Dockerfile của D cần gọi `pnpm exec prisma generate` (ADR-061).
- CHECK `email = lower(email)` dùng `lower()` của Postgres; Zod `z.email()` chỉ nhận ASCII nên không lệch, nhưng nếu domain sau này cho email Unicode thì `toLowerCase()` của JS và `lower()` của PG có thể khác ở ký tự hiếm (vd `İ`).
- Prisma CLI in thông báo "Update available 7.10.0 -> 8.0.0-rc.22" — đúng lý do ADR-061 cấm `npx prisma`.
- Máy dev đang chạy Node 24.18.0, ADR-060 pin 24.22.0 (engines `24.x` nên không chặn).
- **A (T-009) — follow-up**: `apps/api/src/core/http/zod.ts` tự gọi `z.config(vi())` và tự map issue (bỏ `input`) — trùng với `applyVietnameseZodLocale`/`toValidationIssues` của contracts; `core/errors` có danh mục mã lỗi riêng. Đề xuất: API gõ kiểu mã lỗi bằng `ErrorCode` của contracts (hoặc thêm test parity) để FE và BE không lệch. Không sửa vì ngoài phạm vi.
- Container tạm `t010-pg` (cổng 5433) vẫn chạy cho Tech Lead review; xóa bằng `docker rm -f t010-pg` khi xong.

## 8. Câu hỏi mở
- Duyệt các file ngoài phạm vi ở mục 3.
- `ROLE_PERMISSIONS` ở domain (security.md §3.2 ghi `ReadonlySet`) vs contracts (`readonly Permission[]` theo data-and-api §5.3) — test parity ở `apps/api` (B, Phase 2) cần so theo tập, không theo thứ tự.
