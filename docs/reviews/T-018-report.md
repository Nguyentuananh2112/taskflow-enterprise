# T-018 — Báo cáo: Module Task (domain + use cases, TDD, InMemory)

**Người làm:** Engineer C (`taskflow-enterprise-d7`) · **Branch:** `feat/T-018` (rebase trên `main` @ `791f6fa`, đã có T-015 và T-016)

## 1. Đã làm
`apps/api/src/modules/task/**` (đúng phạm vi sở hữu):

| Tầng | File | Nội dung |
|---|---|---|
| domain | `task.ts`, `task-props.ts` | Aggregate `Task`: `create/reconstitute/update/moveTo/assignTo/softDelete/assertVersion/toPrimitives`. Lệnh không đổi gì ⇒ `false` (R15); mỗi thay đổi thật: `version + 1` đúng một lần và đúng 1 domain event |
| | `task-status.ts` | `ALLOWED_TRANSITIONS`: **nguồn sự thật** (ADR-043), `assertTransition` |
| | `task-fields.ts`, `rank.ts`, `task-events.ts`, `task-errors.ts` | Luật R1/R2/R4, number ≥ 1, value object `Rank`, 6 domain event (ADR-013), `TaskAlreadyDeletedError` |
| application | `task.policy.ts`, `task-actor.ts` | `TaskPolicy` (ADR-021/022/041): `can`, `canDelete`, `canAssign`, `canAssignOnCreate`. Bảng role → quyền **tiêm qua `IRolePermissions`** (composition root wire `roleAllows` của Workspace), Task không giữ bản sao ma trận. `TaskRole` / `TaskPermission` lấy kiểu từ `modules/workspace` (type-only) |
| | `task-commands.ts` | Các bước chung theo thứ tự 404 → 403 → 422 → 409 → domain → no-op. Ghi có điều kiện version (ADR-010). Mỗi domain event = 1 dòng audit trong cùng UoW (ADR-012, có `requestId`). Realtime + domain event phát **sau commit**; lỗi được log riêng (`task.realtime_failed`, `task.events_publish_failed`). Trùng rank ⇒ thử lại cả transaction tối đa 3 lần rồi `409 RESOURCE_CONFLICT` |
| | `use-cases/*` | Create, Move, Assign, Update, Delete, `TaskQueries` (get/list/audit-logs, cursor opaque theo `kind`, CQRS-lite ADR-015) |
| | `task-assignment-cleaner.ts` | `implements ITaskAssignmentCleaner` (`import type` từ `modules/workspace`); chữ ký `unassignAllForUser({ workspaceId, userId, actorId }) → { unassignedTaskCount }` đúng test-spec §3.3, đã chốt với B |
| | `task-audit.ts`, `task-dto.ts`, `task-realtime.ts` | old/new theo data-and-api §1.5 (description chỉ `{ changed, length }`), `TaskDto` theo contracts, 1 use case ⇒ 1 realtime event (RT-09) |
| | `ports/*` | `ITaskRepository`, `ITaskAuditLogRepository`, `ITaskReadModel`, `ITaskProjectStore`, `IAssigneeDirectory`, `IUserRefReader`, `IRankGenerator`, `ITaskRealtimeNotifier` (khớp cấu trúc `RealtimeGateway.emitToProject` của T-016) |
| infrastructure | `persistence/in-memory/*` | Một "DB" InMemory dùng chung, đăng ký với `FakeUnitOfWork` để rollback thật. Mô phỏng FK kép, unique (project, number), unique partial rank, phạm vi tenant, ws xóa mềm |
| | `rank/fractional-index-rank-generator.ts` | `fractional-indexing` **4.0.0** |
| | `index.ts` | Public API **type-only** cho Workspace (T-020) implements port; test chặn export runtime |
| testing | `task-harness.ts` | Fixture chuẩn §0.2 (W1/W2, Olivia…Zed, P1/P2/P3/Q1) |

## 2. Phối hợp với B
- `ITaskAssignmentCleaner`: chốt theo bản trong spec (test-spec-task §3.3, ADR-090). B đã sửa T-015 trước khi merge. Dòng ROL-06 trong `test-spec-auth-workspace.md` vẫn ghi tên cũ `unassignAllInWorkspace` — **Tech Lead cần sửa** (B đã ghi trong report T-015).
- T-020 (B) sẽ hiện thực bản Prisma của `IAssigneeDirectory.roleOf` (`FOR SHARE OF m`, loại user đã ẩn danh hóa), `ITaskProjectStore` (`allocateTaskNumber`, có `AND archived_at IS NULL`; tôi đã chỉ ra B thiếu điều kiện này lúc đầu) và `IUserRefReader`. Mọi port liên module dùng tham số object có tên.

## 3. Quyết định tự đưa ra
1. **Thứ tự kiểm ở Move**: 404 → 403 → 422 archived → 409 version → state machine → anchor (`INVALID_ANCHOR`) → no-op. Spec chỉ chốt "422 archived/luật nghiệp vụ trước 409". Tôi xếp `INVALID_ANCHOR` và `INVALID_STATUS_TRANSITION` **sau** 409 vì cả hai cần dữ liệu mới nhất (đúng mục 0.4 "409 → domain"). Ở Assign, `ASSIGNEE_NOT_MEMBER` đứng **trước** 409 (luật nghiệp vụ, UC-AS12).
2. **No-op của Move**: "đúng chỗ cũ" = cùng cột **và** rank hiện tại đã nằm giữa hai hàng xóm đích (tính trên DB, bỏ qua chính task). Cách này phủ được mọi dạng anchor (afterId, beforeId, không anchor = cuối cột).
3. `ForbiddenError.details.required` khi policy từ chối assign/delete ghi `task:assign:any` / `task:delete:any` (quyền đủ để làm).
4. Bỏ gán do hệ thống: `originClientId = null`, để mọi tab (kể cả của actor) đều áp dụng event.
5. Test parity TE-M19 đặt ở `application/` vì ESLint cấm domain import contracts, kể cả trong file test.
6. **Lệch spec ở fixture rank**: §3.2 ghi IN_PROGRESS `[D "b0", E "b1"]`, nhưng đó không phải khóa `fractional-indexing` hợp lệ (đầu `b` cần 2 chữ số, vd `"b00"`). Test tầng A dùng rankGen thật nên đổi thành `"a5"`/`"a6"`. Đề nghị sửa spec.
7. **Phát hiện ở thư viện**: `generateKeyBetween("a1", "a0")` của 4.0.0 trả `"a0V"` (nằm ngoài khoảng) thay vì ném lỗi. Thư viện chỉ kiểm `a < b` khi hai khóa có cùng phần nguyên. Adapter tự chặn `before >= after`, có test.

## 4. Thay đổi ngoài phạm vi
- `pnpm-workspace.yaml` (catalog `fractional-indexing: 4.0.0`, đã kiểm trên npm registry: latest = 4.0.0, trùng stack-versions §2), `apps/api/package.json` (dependency), `pnpm-lock.yaml`.

## 5. Definition of Done
```
$ pnpm typecheck && pnpm lint && pnpm test        # exit 0, chạy trong D:\TaskFlow_wt\T-018 sau rebase
apps/api lint:deps: ✔ no dependency violations found (238 modules, 795 dependencies cruised)
apps/web lint:deps: ✔ no dependency violations found (92 modules, 170 dependencies cruised)
 Test Files  90 passed (90)
      Tests  956 passed (956)            # module task: 154 test
```

**Test chập chờn do tải máy** (ghi lại cho đúng sự thật): trong lúc nhiều phiên cùng chạy, 2 lượt `pnpm test` trước rebase cuối đỏ đúng 1 test mỗi lượt, cả hai đều hết giờ 5 s và **không thuộc module Task**: `packages/contracts/src/exports.test.ts` (`import()` động lần đầu) và `apps/api/src/app.test.ts` "JSON hỏng ⇒ 400". Chạy lại riêng hoặc với `--maxWorkers=2` thì xanh; lượt DoD cuối ở trên xanh với cấu hình mặc định. Đề xuất (ngoài phạm vi): `exports.test.ts` (của tôi, T-010) đổi sang import tĩnh để khỏi tốn transform lúc chạy test.
Coverage module task (v8, không tính test/testing/index):

| Tầng | Stmts | Branch | Lines | Ngưỡng |
|---|---|---|---|---|
| domain | 99,25% | 100% | 99,16% | ≥ 90% ✅ |
| application | 97,6% | 91,95% | 99,03% | ≥ 80% ✅ |
| application/use-cases | 100% | 97,1% | 100% | ≥ 80% ✅ |

## 6. Truy vết case → file test
Đường dẫn tương đối `apps/api/src/modules/task/`.

| Case (test-spec-task.md) | File |
|---|---|
| TE-C01..C14, TE-M01..M18, TE-M20, TE-A01..A05, TE-U01..U08, TE-D01..D03, TE-V01..V04 | `domain/task.test.ts` |
| TE-M19, TP-P02 | `application/task-status-parity.test.ts` |
| TP-P01 | `modules/workspace/application/role-permissions-parity.test.ts` (B, T-015) |
| TP-D01..D07, TP-A01..A12, TP-AC01..AC05, TP-U01..U02 | `application/task.policy.test.ts` |
| UC-CR01..CR15 (+ archive giữa chừng, retry trùng rank) | `application/use-cases/create-task.use-case.test.ts` |
| UC-MV01..MV22 (+ save có điều kiện trả false ⇒ 409) | `application/use-cases/move-task.use-case.test.ts` |
| UC-AS01..AS12, UC-UN01..UN05, UC-UN06 (phần event task), UC-UN07 | `application/use-cases/assign-task.use-case.test.ts` |
| UC-UP01..UP10, UC-DL01..DL10 (+ field lạ bị bỏ qua, rank được giải phóng) | `application/use-cases/update-delete-task.use-case.test.ts` |
| UC-LS01..LS04, LS06..LS08, LS10, LS11, LS13; UC-AU01..AU03, AU05, AU06 (bản A trên InMemory) | `application/use-cases/task.queries.test.ts` |
| RT-01..RT-06, RT-08, RT-09, UC-AU08 | `application/task-realtime.test.ts` |
| Adapter rank | `infrastructure/rank/fractional-index-rank-generator.test.ts` |
| Public API type-only | `index.test.ts` |

## 7. Case tầng I/C chưa làm (để ticket Prisma repository của Task)
- **I:** UC-CR16..CR22, UC-MV23, UC-MV24 (UPDATE `version = expected` trên DB thật), UC-AS13 (`FOR SHARE`, phần của B ở T-020), UC-UP11, UC-DL11..DL13, UC-LS01..LS13 trên SQL thật (gồm LS05 cursor khi dữ liệu đổi, LS09, LS12 `EXPLAIN`), UC-AU01..AU07 trên SQL (AU04: tên ẩn danh qua `IUserRefReader` của B, AU07: FK Restrict, đã có trong `test/integration/constraints.int.ts` của T-010).
- **I-HTTP:** UC-UP12, UC-UP13 (route + Zod strict, Phase 3).
- **C:** CC-CR01..CR05, CC-MV01..MV04, CC-UN01, CC-DL01.
- **RT-07 phần vỏ** (`eventId`, `occurredAt`, phòng `project:{id}`): do gateway T-016 sinh. Ở đây test kiểm `data` + `meta` và ráp lại vỏ để khớp schema contracts.
- UC-UN06 phần `member:role-changed`: thuộc Workspace.

## 8. Rủi ro / câu hỏi mở
- `ITaskRepository` của bản Prisma cần: `findLive` lọc ws chưa xóa mềm; `save` dùng `updateMany({ where: { id, version } })`; map lỗi unique `tasks_rank_live_key` ⇒ `RankConflictError`. Postgres hủy transaction khi vi phạm unique, nên retry đã được đặt ở mức **cả transaction** (`inTransactionWithRankRetry`).
- `listAssignedForUpdate` cần `FOR UPDATE` (data-and-api §1.9). Chỉ có repo Task hiện thực được, B không làm.
- Composition root (Phase 3) cần wire `IRolePermissions` bằng `roleAllows` của Workspace, notifier bằng `RealtimeGateway`, các adapter của B (T-020).
