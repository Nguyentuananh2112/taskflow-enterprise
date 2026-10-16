# T-039 — Bàn giao (Engineer D → phiên D kế tiếp)

> **TRẠNG THÁI: ĐÃ MERGE** — `main` 35e4589 (merge `feat/T-039-leave` @ 87255e8). Cổng TL đều exit 0: verify 8/8,
> integration 747/747, security, web build, e2e-tsc. Hộp đen F `SEC_RUN_PENDING=T-039` 37/37 (gồm SEC-HR-10 / CC-HR-11
> thu grant ‖ approve). B APPROVE bảo mật, A OK composition. Báo cáo đầy đủ: `docs/reviews/T-039-report.md`.
> Việc còn mở: **§3** (dời, không chặn) và **§4** (theo dõi).

## 1. Bản đồ code (đọc theo thứ tự này)

| Chỗ | Nội dung |
|---|---|
| `apps/api/src/modules/leave/domain/` | Thuần, không import contracts (ADR-043): `leave-days.ts` (nửa ngày nguyên, ô (ngày, AM/PM), `leaveDatesWithin`), `leave-status.ts` (bảng chuyển §9, `localDate`), `leave-balance.ts`, `leave-errors.ts` |
| `application/leave-kit.ts` | Phần dùng chung: `requireActor`, `reload` (version), `save`, `assertBalance` / `summarizeStored`, `yearCalendar`, `today()` (UTC±1, chọn ngày khớp múi giờ của chính lịch ngày đó), `dto()` (UserRef) |
| `application/use-cases/` | submit / decide (approve·reject·revoke) / cancel / adjust-balance — **mọi lệnh đổi số dư khóa (ws, CHỦ ĐƠN) trước khi đọc**; HR ghi qua `membership.authorizeHrWrite` TRONG khóa; preview / list-balances là query |
| `application/leave-queries.ts` | listMine / listForHr / myBalance / listBalances / preview / `approvedLeaves` (adapter cho attendance) |
| `application/ports/` | `leave.ports.ts` (repo, lịch, membership, notifier, audit) · `leave-read-model.port.ts` (read model, `leaveSummaries`, danh bạ nhân viên, user refs) |
| `infrastructure/persistence/` | InMemory (repo + read model trong một lớp, snapshottable) · Prisma: repo, read model, `PrismaLeaveEmployeeDirectory` |
| `presentation/` | `leave.routes.ts` — middleware **theo từng route** (mount ở `/workspaces/:wsId`, `router.use` sẽ chạy cho cả route workspace ⇒ xác thực / limiter 2 lần — T-028 F1); `permitLeave` TRƯỚC validate body/query |
| `testing/` | `leave-harness.ts` (fixture §0.2 UUID thật) · `leave-fakes.ts` · `leave-backend.ts` (InMemory / Prisma — cùng harness cho tầng I/C) |
| `apps/api/src/composition/` | `leave-wiring.ts` (`wireLeave`, `LateApprovedLeaves` — leave ↔ attendance phụ thuộc vòng ⇒ gắn sau), `leave-adapters.ts` (membership/audit ← T-037, factory repo, danh bạ chế độ bộ nhớ), `persistence-guard.ts` (tách khỏi `persistence.ts` vì max-lines, re-export) |
| `packages/contracts/src/leave/` | Schema body/query/DTO (enum lấy từ `hr.schemas` của B) |
| Test | `test/http/leave.http.test.ts` · `test/contract/leave-*.test.ts` · `test/integration/leave/` (persistence, read model, concurrency ×`LEAVE_CC_REPEAT`) |

## 2. Hợp đồng với module khác (đổi phải báo người sở hữu)

- **Attendance (A)**: leave dùng `attendance.workCalendar` (`AttendanceWorkCalendar`; `isWorkday` và `isHoliday` độc lập — leave đếm `isWorkday && !isHoliday`). Attendance dùng `leave.approvedLeaves` (mọi ngày lịch biểu của đơn APPROVED trong [from, to], kể cả CN/lễ; `userIds = []` ⇒ `[]`).
- **Workspace / T-037 (B)**: `authorizeHrWrite` = `HrAccess.authorizeWrite` (FOR SHARE + luật tự xử lý), `isEligibleRequester` = `isEmployee`. Audit qua `HrAuditWriter`; lý do QUẢN TRỊ ghi ở `after.note` (trim, rỗng ⇒ không có khóa) — **không bao giờ** là `reason` của đơn (điều kiện của B, có test HTTP "sốt cao").
- **Notifications / T-040 (G)**: `leaveNotifierFrom(publisher)`; gọi TRONG `uow.run` (ngoài ⇒ `NotifyOutsideTransactionError`); `hr` = mọi người có `hr:manage` hiện tại trừ actor. `leave.summaries` (`leaveSummaries`: tra (ws, id), chỉ loại + ngày) sẵn cho T-040b — xem §4.
- **Web (E, H)**: contracts `@taskflow/contracts/leave`; danh sách dùng phong bì chuẩn (`data` + `meta.page`); `remainingDays` của preview = số dư TRƯỚC đơn.

## 3. Việc bị dời (không chặn merge)

1. **k6 cặp đảo `perf/task-read-raw`** (raw → base + 2 cpu-prof). Lệnh: `AB_ORDER="raw base" PROF_ORDER="raw base" bash <scratchpad>/ab-raw.sh`. Điều kiện: CPU nền < 20% trong 3 mẫu liên tiếp **và** báo TL / xin lượt trước khi chạy. Tiêu chí merge của TL: cặp đảo cũng cho CPU API ≤ −15% ở 150 RPS. Cặp hợp lệ hiện có: 101% → 85% (−16%); P95 đọc ở 200 RPS 1862 → 216 ms.
2. **Stryker leave-domain** (sáng mai): `apps/api/src/modules/leave/domain/` — chạy theo lượt TL. Mutant tay đã bắt: bỏ khóa advisory (CC-HR-04/05 đỏ 5/5) + 3 mutant domain; Stryker là để đo đủ.

## 4. Theo dõi / rủi ro đã chấp nhận

- **T-040b (G)**: khi nhánh L2 vào main, composition nối `leaves: leave.summaries` thay `noLeaveSummaries` và bỏ `InMemoryNotificationContextReader` (hiện đã ủy quyền cho `leaveSummaries`). Ai merge sau gỡ xung đột `notification-adapters.ts` / `persistence.ts`.
- **PATCH balance không có `expectedVersion`** — rủi ro chấp nhận (TL, cùng loại ADR-117): giá trị tuyệt đối, ghi trong khóa, audit before/after.
- **`today()` ngày đổi múi giờ**: có thể 2 ngày cùng khớp ⇒ lấy ngày sớm hơn (đã báo A).
- **Danh bạ nhân viên chế độ bộ nhớ** đọc hết thành viên mỗi trang (`MemberListEmployeeDirectory`) — chỉ local/test; Prisma là một truy vấn keyset.
- **R27 (lưu giữ dữ liệu cá nhân)** — đề xuất của TL đang chờ người dùng; `leave_requests.reason` là dữ liệu có thể nhạy cảm, nếu chọn phương án có job xóa thì leave cần job/purger tương ứng.
- **Bảng `leave_requests`** chưa có index `(workspace_id, created_at, id)` cho keyset danh sách — đủ cho v1; xem lại nếu số đơn lớn.
