# T-065c — Web trên nền code T-061 (fbbf71f): bỏ đăng ký, bỏ grant workspace, thêm thành viên theo nhân viên — báo cáo Engineer E

Nhánh `feat/T-065c-members` (worktree T-025) = `feat/T-065b-hr-admin` @64ce8d2 + merge `fbbf71f` (B, T-061 code) — `5ab7c76` merge, `c1984c7` web. Thứ tự merge vào `feat/company-level`: T-061 → T-065a → T-065b → T-065c. Chưa push.

T-065b có thêm `64ce8d2` (sau báo cáo T-065b): người nhận OWNER = `members` của ws mồ côi (TL/B chốt), mật khẩu yếu khi kích hoạt = **400** (B chốt, không phải 422).

## Đã làm

- **Web biên dịch trên fbbf71f** (mục tiêu TL): `MeResponse.company` dùng contracts (bỏ mirror); còn giữ MỘT mirror tạm `AdminWorkspaceWithMembersDto` (`members[]` khi mồ côi) tới khi B thêm vào contracts.
- **Bỏ tự đăng ký (ADR-137)**: xóa `/register`, `features/auth-register`, `authApi.register`, handler mock `/auth/register`. Trang đăng nhập: "Chưa có tài khoản? Hãy nhờ bộ phận nhân sự gửi link kích hoạt." Test mock / auth-flow tạo tài khoản sẵn rồi đăng nhập; ca PasswordPolicy chuyển sang `/auth/activate`; ca email chuẩn hóa chuyển sang `POST /hr/employees` (409 `already_employee`); thêm ca "không còn `/auth/register`".
- **Bỏ grant theo workspace (ADR-134)**: xóa công tắc "Quản lý nhân sự" ở Thành viên ws (`features/member-grants`, cột bảng), `usePermission` chỉ theo role (`roleHasPermission`), mock members / workspaces / events không còn grants; xóa `test/hr-grants`.
- **Thêm thành viên** = combobox **"Tìm nhân viên"** (`GET workspaces/:wsId/member-candidates`, gõ ≥ 2 ký tự, debounce 300 ms, lựa chọn "tên · email"), body `{userId, role}`; lỗi lời thường cho `NOT_ACTIVE_MEMBER` / `already_member` / 404. Mock candidates: nhân viên chưa ở ws, không có lịch nghỉ, ≤ 20.
- **Realtime**: bỏ `member:grants-changed`; nối **`company:access-changed`** ⇒ làm mới `/auth/me`, mất quyền ⇒ xóa cache `['company','hr'|'admin'|'payroll']` ngay, toast. Gỡ tập tạm `WEB_PENDING_T065` trong `apps/api/test/contract/realtime-event-parity.test.ts` (TL giao) — parity 15/15.
- **Thông báo**: DTO không còn `workspaceId/workspaceName`; câu + link cho `ACCESS_CHANGED`, `OFFBOARD_SCHEDULED`, `OFFBOARD_CLEANUP`.
- 3 ca `it.todo` (đổi quyền realtime) thành test thật (helper `pushAccessChanged`).

## Quyết định / ghi chú

1. `MemberCandidateDto` không có trạng thái ⇒ combobox **không** ghi "chờ kích hoạt" như dự kiến (đã báo F tên dự kiến có hậu tố đó — bỏ hậu tố). Nếu cần, B thêm `status` vào DTO.
2. `OFFBOARD_SCHEDULED` gửi cả người nghỉ lẫn Admin nhưng DTO không có tên người nghỉ ⇒ câu "X đã lên lịch nghỉ việc — xem chi tiết".
3. `apps/api/tsconfig.exclusions.json` (danh sách loại tạm phía API mà ghi chú parity nhắc) **không** đụng — phần API của B/A.
4. Mock chưa phát `company:access-changed` khi `PUT admin/access` (mock không có board ở handler admin) — test phát bằng helper.

## Kết quả lệnh (worktree T-025)

- `pnpm --filter web typecheck`: exit 0 · `eslint src test app`: exit 0 · `lint:deps`: no violations (568 modules)
- `vitest run --maxWorkers=2` toàn bộ web: **91 file, 660 passed, 0 todo, exit 0**
- `apps/api` `test/contract/realtime-event-parity.test.ts`: 15/15 · `tsc --noEmit` e2e: exit 0
- CHƯA: `pnpm verify` đầy đủ (gồm api/integration), Playwright.

## Còn chờ / rủi ro

- B: `members` trong `AdminWorkspaceDto` (xóa mirror cuối), route `member-candidates` vào OpenAPI nếu chưa có.
- E2E (F, T-066): `apiRegister`/`registerViaUi` giờ 404; mọi selector "Thêm thành viên theo Email" đổi sang combobox "Tìm nhân viên".
- Chưa xem trên trình duyệt thật.
