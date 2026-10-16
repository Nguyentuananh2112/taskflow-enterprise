# T-038 — Bàn giao (Engineer A → Engineer A phiên sau)

> Nhánh `feat/T-038-attendance`, HEAD `b657b6a` (+ commit của file này), 20 commit trên `main` 6fcdce4 (đã có
> T-037, T-037b, T-040). Worktree `D:\TaskFlow_wt\T-024` (dùng lại theo ADR-107). Mọi commit đã qua hook đầy đủ.
> Báo cáo chi tiết (phạm vi, quyết định, review B): `docs/reviews/T-038-report.md`. Việc còn lại: mục 4.

## 1. Trạng thái ngắn

- Code T-038 ĐỦ phạm vi ticket: domain, check-in/out, me/*, HR today/month/events/ADJUSTMENT/void, lịch + ngày lễ,
  CSV, adapter `WorkCalendarPort` cho leave, 16 route + OpenAPI A2, composition (memory + Prisma).
- Review bảo mật B: **APPROVE** (@cdd3096). LOW-1 đã sửa; LOW-2/3 ghi trong report; MEDIUM-1: notifier thật ĐÃ nối,
  `noApprovedLeaves` TL chấp nhận tới T-039.
- **Chưa chạy (TL giữ lượt máy):** verify + integration (5 runner LSP attendance) + security của TL, rồi F chạy
  `SEC_RUN_PENDING=T-038` (hộp đen) làm cổng thứ hai. TL dặn: A KHÔNG tự chạy integration nữa.

## 2. Nối với module khác (composition root)

| Port (attendance sở hữu) | Nối tới | Trạng thái |
|---|---|---|
| `IHrAccess` (`authorizeWrite`, `isEmployee`) | `workspace.hrAccess` (T-037) | thật |
| `IHrAuditRecorder.record` | `workspace.hrAudit` (`HrAuditWriter`, chặn khóa `reason`) | thật |
| `IMembershipTenurePort.tenuresOf` (instant `[from, to)`) | `workspace.tenure` (T-037b) | thật |
| `AttendanceNotifier.attendanceAdjusted` | `attendanceNotifierFrom(notifications.publisher)` (T-040) | thật — ném nếu gọi ngoài `uow.run` |
| `ApprovedLeavePort.approvedLeaves` | `noApprovedLeaves` (`composition/attendance-adapters.ts`) | **TẠM** — D thay bằng `leave.approvedLeaves` (tham chiếu trễ) ở T-039 |
| `AttendanceMembership.permissionsOf` | `effectivePermissions(resolveActor)` | thật |
| (cung cấp cho leave) `attendance.workCalendar` | `IWorkCalendarPort` của D | D nối ở T-039 |

## 3. Bẫy đã gặp (đừng lặp lại)

- Sau MỌI rebase: `pnpm install --frozen-lockfile` **và** `pnpm exec prisma generate` trong `apps/api` (migration 4
  của B) — thiếu bước sau thì tsc báo thiếu `workspaceMemberDeparture`.
- pnpm qua shim trong scratchpad của phiên (`export PATH=<scratchpad>/shim:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0`);
  phiên mới phải tạo lại shim (xem memory `techlead-verify-workflow`).
- Heredoc bash dài có ký tự đặc biệt hay vỡ ⇒ viết script Python vào scratchpad rồi chạy. `sed` nuốt `\u` trong
  chuỗi thay thế (`\uFEFF` ⇒ `FEFF`) — dùng Python.
- POST/PUT luôn cần `Content-Type: application/json` (415 chạy TRƯỚC auth) — check-in gửi `{}`.
- Test HTTP: đặt `t.clock` TRƯỚC khi `register` — dời đồng hồ sau đó làm access token (15 phút) hết hạn ⇒ 401.
- `max-lines` 200: `in-memory-attendance.ts`, `persistence.ts` đã sát ngưỡng — thêm gì thì tách file.
- Không dùng `Intl.supportedValuesOf('timeZone')` để kiểm múi giờ (thiếu `Asia/Ho_Chi_Minh`).
- Hai tin nhắn chéo session có thể đi CHÉO nhau (chữ ký tenure với B) — chốt bằng một tin "dứt điểm", ghi rõ bỏ tin nào.
- Cổng 3001/4000 và DB dev `taskflow` (5435) là của người dùng — KHÔNG đụng. Integration dùng DB `tl_a038` cổng 5434,
  Valkey 6380/12, `METRICS_PORT=0`.

## 4. Việc còn lại (theo thứ tự)

1. Chờ TL báo kết quả verify + integration + security của T-038. Đỏ ⇒ sửa trên nhánh này, báo hash mới.
2. Chờ F chạy `SEC_RUN_PENDING=T-038`; F đã đối chiếu route @cdd3096 (khớp), harness của F ở `test/T-042-hr-align`.
3. Khi cả hai cổng xanh: điền mục "Lệnh đã chạy" trong `T-038-report.md` (exit code từng bước) và gửi
   **DONE T-038** cho TL kèm hash + exit code.
4. Sau khi T-038 vào main: D rebase T-039 (nối `approvedLeaves` thật + `calendar: attendance.workCalendar`); E/H thay
   DTO tạm của web (`m3-provisional`) bằng contracts (tên đã trùng).

## 5. Kết quả lệnh gần nhất (A, máy dev, HEAD b657b6a)

| Bước | Lệnh | Exit / kết quả |
|---|---|---|
| typecheck API | `pnpm exec tsc --noEmit -p .` (apps/api) | 0 |
| lint | `pnpm exec eslint src/modules/attendance src/composition test/http/attendance.http.test.ts` | 0 |
| depcruise | `pnpm exec depcruise src --config .dependency-cruiser.cjs` | 0 |
| unit API | `pnpm exec vitest run` (apps/api) | 0 — 133 file, 1408 test |
| contracts | `pnpm exec tsc --noEmit -p .` · `pnpm exec vitest run` (packages/contracts) | 0 · 0 — 133 test |
| integration LSP (trước rebase T-040, 4 runner) | `pnpm test:integration test/integration/lsp/attendance` | 0 — 37/37 |
