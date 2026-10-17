# T-065a — Trang chính công ty, header công ty, route gốc (web) — báo cáo Engineer E

Nhánh `feat/T-065a-company-home` (worktree T-025), dựng trên `feat/company-level` 3d39d81 + contracts B `1bb5f42` (rebase). Merge vào `feat/company-level`, **không** vào `main`. Chưa push.

| Commit | Nội dung |
|---|---|
| `7c8eaec` | `shared/ui/password-input` — Hiện/Ẩn, luật PasswordPolicy hiện sẵn (cho `/activate`, đổi mật khẩu dùng luôn) |
| `52fae7f` | khối `company` của `/auth/me` + `useCompanyPermission`; mock một công ty |
| `170fce5` | (WIP) chấm công / nghỉ phép / HR sang phạm vi công ty: API + query key, ~25 component bỏ `wsId`, route gốc, mock-api |
| `11760e3` | trang chính `/w`, header công ty (☰ < md), test theo route công ty |
| `2a6d785` | 401 `SESSION_REVOKED` ⇒ kết thúc phiên, không refresh |

## Đã làm (theo company-level.md v2.1, ADR-139)

- **Route gốc** `/attendance`, `/leave`, `/hr`; xóa `/w/[wsId]/{attendance,leave,hr}`. `/w/[wsId]/projects` **không còn** thẻ chấm công / lời nhắc (E A3).
- **API + cache**: `attendanceApi`/`leaveApi`/`hrAttendanceApi`/`hrLeaveApi` theo §4 (`/attendance/me/today`, `/attendance/check-in`, `/leave/requests`, `/leave/balances/me`, HR `/attendance/today|events|schedules|holidays|export.csv`, `/leave/requests/:id/{approve,reject,revoke}`, `/leave/balances/:userId/:year`); key gốc `['company', …]`. Component chỉ bỏ prop `wsId` (chỉ dùng dựng URL). Link thông báo về route gốc.
- **Quyền công ty**: `useCompanyPermission()` (`entities/session`) đọc `permissions` server tính trong `/auth/me`. Trang `/attendance`, `/leave`: Admin (không `*:self`) thấy câu "Tài khoản Quản trị không chấm công / không xin nghỉ phép" + "Về trang chính". `/hr`: thiếu `hr:manage` ⇒ câu + lối về (E A5). Trong HR: `isOwner` ⇒ `isAdmin` ("trừ OWNER" ⇒ "trừ Admin", ADR-135).
- **Trang chính `/w`** (360 px trước): dải "Bạn làm việc tới hết ngày dd/mm/yyyy" khi OFFBOARDING (E A6) → thẻ chấm công **gọn** (nhân viên; Admin không có) → lời nhắc chấm công (T-045, nhớ theo người/ngày) → **"Việc quản lý"** ô lớn theo quyền (Nhân sự — số đơn chờ cả công ty, mở thẳng tab Đơn nghỉ; Quản trị → `/admin`) → lối tắt Bảng công · Xin nghỉ · Đơn nghỉ của tôi → **"Workspace của bạn"** + Tạo workspace → khu đã xóa. Mọi khối chờ `/auth/me` **một lần** rồi dựng cả trang (khối theo quyền không "hiện ra sau" đẩy nội dung). `h1` "Trang chính" sr-only.
- **Header mọi trang**: < md nút ☰ mở danh sách đủ mục (Trang chính, Bảng công của tôi, Nghỉ phép, Nhân sự, Quản trị — theo quyền; dòng 48 px; Esc đóng + trả focus); ≥ md hàng link Trang chính + việc quản lý; tên công ty ≥ lg; nút Vào/Ra gọn ≥ sm cho nhân viên. `HeaderHr` cũ xóa.
- **`SESSION_REVOKED`**: http client coi như `UNAUTHORIZED` ⇒ phiên kết thúc "revoked", không gọi `/auth/refresh` (B xác nhận).
- **Mock-api**: `MockCompany` (một công ty; mọi user mock là EMPLOYEE như backfill; `setAccess`, `setOffboarding`, `remove`), guard `requireCompany` (401 `SESSION_REVOKED` → 403 trước validate), handler chấm công / nghỉ phép / HR trên route công ty với một khóa phạm vi `COMPANY_SCOPE` (UUID — DTO Mốc 3 còn `workspaceId`), thông báo HR lọc theo `hr:manage` cấp công ty.
- **PasswordInput** dùng chung (ADR-137 "tách trước khi xóa /register").

## Quyết định tự đưa ra

1. **Thẻ đầy đủ ở `/attendance`** = `TodayBox` sẵn có; `AttendanceCard` trở thành thẻ gọn của trang chính (bỏ hàng lối tắt; lối tắt ra ngoài thẻ, bỏ ô "Nhân sự" vì đã có ô ở "Việc quản lý"). Giữ tên vùng "Chấm công" và các nhãn `Trạng thái`/`Vào / Ra` ⇒ selector E2E cũ dùng lại được ở `/w`.
2. **Khung thẻ gọn** `min-h-[19rem]` (360) / `md:min-h-44` — **ước theo bố cục, chưa đo**; E2E-HR-14 chuyển sang đo `/w` (F).
3. **"Bảng lương"** chưa có lối vào (trang ở Mốc 4) — như "Phiếu lương". **"Quản trị"** đã có lối vào `/admin` dù trang làm ở T-065b (cùng nhánh tích hợp, trước merge `main`).
4. Giữ tên view `WorkspacePickerPage` cho trang chính (route + harness không đổi); nội dung là trang chính.
5. Test component: mỗi ca một mock mới ở những file có danh sách cả công ty (`hr-page`, `check-in-prompt`, `company-home`) — một công ty ⇒ người / đơn của ca trước lọt sang ca sau (đúng cảnh báo F, ADR-140).

## Kết quả lệnh (worktree T-025, chỉ việc nhẹ — A đang đo)

- `pnpm --filter web typecheck` (next typegen + tsc): exit 0 · `tsc --noEmit` e2e: exit 0
- `eslint src test app`: exit 0 · `lint:deps` (dependency-cruiser FSD): **no violations** (537 modules)
- `vitest run --maxWorkers=2` toàn bộ web: **90 file, 643 passed + 3 todo, exit 0** (commit `11760e3` ghi nhầm "644" — số đúng là 643). Sau `2a6d785`: `src/shared/api` + `auth-flow` 37/37.
- Hook pre-commit (gitleaks, prettier, eslint) xanh ở mọi commit.
- **CHƯA chạy**: `pnpm verify` đầy đủ, Playwright (API T-061/T-063/T-064 chưa có).

## Còn chờ / rủi ro

- **B (T-061 code commit)**: `MeResponse.company` ⇒ xóa `apps/web/src/shared/api/pending-contracts/company.ts`, dùng `MeResponse`; event `company:access-changed` (envelope) ⇒ web nối: refetch `/auth/me` + xóa `['company','hr'|'payroll']` khi mất quyền + toast. 3 ca đang `it.todo` (hr-page ×2, notification-bell ×1) viết khi có event. Handler `member:grants-changed` cũ còn trong `use-realtime-session` tới khi B bỏ event.
- **A/D (T-063/T-064)**: web gọi đúng đường dẫn §4; nếu A/D đổi tên route/query thì báo — mock-api đang theo §4.
- **E2E** (`e2e/specs/hr.e2e.ts`, 28 chỗ dùng `/w/<ws>/projects|attendance|leave|hr` hoặc grant theo ws): HR-01, 04, 05, 07 (a11y `/projects` + thẻ), 09 (thẻ ở `/projects`), 10–14 (lời nhắc/thẻ ở `/projects` ⇒ `/w`), 03/18 (grant ⇒ `/admin/access`) phải viết lại theo trang chính + harness ADR-140 — thuộc T-066 (F) khi API có; mình sửa phần selector web nếu F cần.
- Nhãn "Bảng công của tôi" / "Nghỉ phép" trong ☰ — nếu người dùng muốn từ khác thì đổi một chỗ (`company-nav.tsx`).
- Chưa xem trên trình duyệt thật (dev server cũ PID 29036 vẫn chờ người dùng tắt).
