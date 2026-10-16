# T-039 — Module leave (nghỉ phép) — báo cáo Engineer D

Nhánh `feat/T-039-leave`. Nguồn: `docs/design/attendance-leave.md` §2 (ADR-122), §4, §5, §9 · `docs/design/test-spec-hr.md` §2–§4, §8.

> Trạng thái: **chưa DONE**. Còn: nối composition root (cần adapter T-037/T-038/T-040 trên main), test HTTP/SEC, chạy tầng I/C ×20 lượt cuối (xin lượt TL).

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
- **reason tùy chọn** (TL): trim, ≤ 1000, rỗng ⇒ `null`. Cột `reason` của migration 3 vẫn `NOT NULL` ⇒ repo lưu `''`, đọc `''` ⇒ `null` (không cần migration mới). Chỉ người gửi + `hr:manage` thấy; không vào audit/thông báo.
- **revoke thiếu lý do ⇒ 400** (Zod, TL chốt — spec @7d77e36). `REASON_REQUIRED` 422 chỉ khi OWNER tự xử lý.
- **PATCH balance**: `adjustmentDays` là giá trị **tuyệt đối**; được phép kể cả `remaining − pending < 0` (TL chọn (a)); approve sau đó vẫn 422. Trả dòng số dư mới (H). **Không** có `expectedVersion` ở v1 (giá trị tuyệt đối + audit mỗi lần) — chờ TL xác nhận.
- **GET không ghi**: đọc số dư năm chưa có dòng ⇒ mặc định 12 ngày, không `INSERT` (dòng chỉ tạo lười trong lệnh ghi — LB-01 / CC-HR-12).
- **preview** `remainingDays` = số dư TRƯỚC đơn (= `leave-balances/me`); khác ANNUAL ⇒ `null`; không khóa, không ghi.
- **ApprovedLeavePort** trả mọi ngày lịch biểu của đơn APPROVED trong [from, to] (kể cả CN/lễ) — attendance tự áp ưu tiên HOLIDAY > OFF > ON_LEAVE.
- Danh sách HR số dư: chỉ nhân viên **hiện tại** (không VIEWER, khớp `isEmployee`); người đã rời vẫn PATCH được nếu có lịch sử (LB-06).

## 3. Kiểm thử

| Tầng | Nội dung | Kết quả |
|---|---|---|
| U/A (in-memory) | domain + LV-01..25, LB-04..08, LD-06/09, read side, preview, ApprovedLeave, reason, DTO parity | 112 xanh (api) · contracts 128 xanh |
| Mutant tay | bỏ khóa advisory ⇒ CC-HR-04/05 đỏ 5/5; 3 mutant domain ⇒ bị bắt | bị bắt |
| I (Postgres) | persistence 12 + read model 5 (mới) | 12 xanh lần trước; read model **chưa chạy** |
| C (×20) | CC-HR-03..12 | 03..10 xanh ×20 (lần trước); 07/08 (siết theo F), 11, 12 **chưa chạy** |

Điểm yếu đã biết: CC-HR-11 hiện ở mức **fake** (thu grant không qua DB) — bản thật cần `HrAccess` + Postgres (FOR SHARE) sau khi nối composition. CC-HR-07/08 chứng minh tuần tự bằng thứ tự audit của spy (ghi trong khóa).

## 4. Còn lại trước `DONE T-039`

1. Nối composition root: membership/audit ← T-037, lịch ← T-038 (A), notifier ← T-040 (G), tên ← auth; `approvedLeaves` → attendance.
2. Test HTTP + SEC-HR (01/02/03/05/07/15/25), LSP chạy lại file test A trên Prisma, CC-HR-11 thật.
3. `pnpm verify` + integration + security exit 0 (lượt TL).
4. Chờ TL: LV-24 parity bảng chuyển (thêm hằng vào contracts hay miễn).
