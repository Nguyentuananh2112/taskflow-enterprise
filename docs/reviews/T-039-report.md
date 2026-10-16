# T-039 — Module leave (nghỉ phép) — báo cáo Engineer D

Nhánh `feat/T-039-leave`. Nguồn: `docs/design/attendance-leave.md` §2 (ADR-122), §4, §5, §9 · `docs/design/test-spec-hr.md` §2–§4, §8.

> **TRẠNG THÁI: ĐÃ MERGE** — `main` 35e4589 (merge `feat/T-039-leave` @ 87255e8). Cổng TL đều exit 0: verify 8/8,
> integration 747/747, security, web build, e2e-tsc. Hộp đen F (`SEC_RUN_PENDING=T-039`) 37/37 — gồm SEC-HR-10 / CC-HR-11
> (thu grant ‖ approve, FOR SHARE thật). Review: B APPROVE (bảo mật), A OK (phần chạm attendance + composition).
> Dời (không chặn): k6 cặp đảo, Stryker leave-domain — xem `T-039-handoff.md` §3.

## 1. Đã làm

| # | Hạng mục | File chính |
|---|---|---|
| 1 | Domain thuần, test-first: đếm **số nguyên nửa ngày**, không vắt năm, chồng ngày theo ô (ngày, AM/PM), máy trạng thái §9 (409 `invalid_transition`), "hôm nay" theo múi giờ lịch, công thức số dư (LB-02 loại chính đơn đang xét) | `domain/leave-days.ts`, `leave-status.ts`, `leave-balance.ts`, `leave-errors.ts` |
| 2 | Lệnh: submit / cancel / approve / reject / revoke / PATCH balance — khóa advisory (ws, **người sở hữu đơn**) TRƯỚC khi đọc, `version` có điều kiện, `requester_not_member`, `NO_WORKING_DAYS`, audit + thông báo trong cùng transaction | `application/use-cases/*`, `leave-kit.ts`, `leave-commands.ts` |
| 3 | Chốt ghi HR = `ILeaveMembership.authorizeHrWrite` (adapter: `HrAccess.authorizeWrite` của T-037, B 6fc740c) gọi **trong khóa** — FOR SHARE membership + luật tự xử lý (403 / OWNER 422 `REASON_REQUIRED`) | `ports/leave.ports.ts` |
| 4 | Phía đọc: đơn của tôi / của HR (keyset `(createdAt, id)` giảm dần, cursor gắn endpoint), số dư của tôi, số dư cả ws (HR, mọi nhân viên sắp theo tên), preview (TL duyệt), adapter `ApprovedLeavePort` cho attendance | `leave-queries.ts`, `use-cases/preview-leave.query.ts`, `list-balances.query.ts` |
| 5 | Persistence Prisma (migration 3 của B): repo + read model + danh bạ nhân viên | `infrastructure/persistence/prisma/*` |
| 6 | Contracts leave (file mới, enum lấy từ `hr.schemas` của B) + parity DTO API ↔ contracts | `packages/contracts/src/leave/*`, `test/contract/leave-*.test.ts` |
| 7 | Presentation: routes (permit TRƯỚC validate body/query), controller, `createLeaveModule` | `presentation/*`, `leave.module.ts` |

## 2. Quyết định (đã chốt với TL / đồng đội)

- **Lỗi 409** dùng code `RESOURCE_CONFLICT` + `details.reason` chữ thường (`invalid_transition`, `overlapping_leave` + `requestId`, `requester_not_member`); 422 dùng `BUSINESS_RULE_VIOLATION` + `rule` chữ hoa.
- **reason tùy chọn** (TL): trim, ≤ 1000, rỗng ⇒ `null`. DB: migration 4 (T-037b, B) cho `reason` NULL + CHECK không rỗng ⇒ lưu `null` trực tiếp; chuẩn hóa ở contracts + domain trước khi ghi. Chỉ người gửi + `hr:manage` thấy; không vào audit/thông báo.
- **revoke thiếu lý do ⇒ 400** (Zod, TL chốt — spec @7d77e36). `REASON_REQUIRED` 422 chỉ khi OWNER tự xử lý.
- **PATCH balance**: `adjustmentDays` là giá trị **tuyệt đối**; được phép kể cả `remaining − pending < 0` (TL chọn (a)); approve sau đó vẫn 422. Trả dòng số dư mới (H). **Không** có `expectedVersion` ở v1 — **rủi ro chấp nhận** (TL, cùng loại ADR-117): giá trị tuyệt đối, ghi trong khóa (ws, user), audit before/after mỗi lần; hai HR sửa cùng lúc ⇒ người sau thắng, có dấu vết.
- **GET không ghi**: đọc số dư năm chưa có dòng ⇒ mặc định 12 ngày, không `INSERT` (dòng chỉ tạo lười trong lệnh ghi — LB-01 / CC-HR-12).
- **preview** `remainingDays` = số dư TRƯỚC đơn (= `leave-balances/me`); khác ANNUAL ⇒ `null`; không khóa, không ghi.
- **LV-24 — MIỄN parity bảng chuyển** (TL): không đưa `LEAVE_TRANSITIONS` vào contracts. Web chỉ ẩn/hiện nút theo `status` + `startDate`; server là nguồn quyết định duy nhất (409 `invalid_transition`). Parity chỉ ở enum (`LeaveStatus`/`LeaveType`/`LeaveDayPart`, `HrConflictReason`, `BusinessRule`, `HrAuditAction`, `NotificationType`).
- **ApprovedLeavePort** trả mọi ngày lịch biểu của đơn APPROVED trong [from, to] (kể cả CN/lễ) — attendance tự áp ưu tiên HOLIDAY > OFF > ON_LEAVE.
- Danh sách HR số dư: chỉ nhân viên **hiện tại** (không VIEWER, khớp `isEmployee`); người đã rời vẫn PATCH được nếu có lịch sử (LB-06).

## 3. Kiểm thử

| Tầng | Nội dung | Kết quả |
|---|---|---|
| U/A (in-memory) | domain + LV-01..25, LB-04..08, LD-06/09, phía đọc, preview, ApprovedLeave, reason, DTO parity | xanh (trong verify 8/8) |
| HTTP | luồng chính, preview, số dư, thông báo thật (T-040), liên module attendance (ON_LEAVE, leaveDays, ngày lễ), SEC-HR-01/02/03/05/06/07/15/25, LV-20, audit không chứa reason | 14 ca xanh |
| Mutant tay | bỏ khóa advisory ⇒ CC-HR-04/05 đỏ 5/5; 3 mutant domain ⇒ bị bắt | bị bắt |
| I (Postgres) | persistence 12 + read model 6 (NULL reason + CHECK, keyset, listApproved, leaveSummaries, danh bạ nhân viên) | xanh (trong integration 747/747) |
| C (×20) | CC-HR-03..12 (07/08 chứng minh thứ tự bằng chuỗi audit + số dư cuối) | xanh ×20 (lượt D 217/217 + integration TL) |
| Hộp đen F | SEC-HR-04/05/07/10/12/25, CC-HR-03..12 ×20, CC-HR-11 thật | 37/37 |

Ghi chú: CC-HR-11 trong suite của D chỉ ở mức fake; bằng chứng FOR SHARE thật là SEC-HR-10/CC-HR-11 hộp đen của F.

## 4. Kết quả

`DONE T-039` — việc còn mở và bị dời: `docs/reviews/T-039-handoff.md`.
