# Mốc 3.5 — Cấp công ty (thiết kế, CHỜ người dùng duyệt)

> Trạng thái: **đề xuất v2.1 — chờ người dùng duyệt** (Tech Lead, 2026-10-17). ADR-133…140 chỉ ghi vào `DECISIONS.md` sau khi người dùng duyệt; rủi ro R37–R41 vào `threat-model.md` §6 (B). Vé T-061…T-066. Chưa ai code trước khi duyệt. **Làm TRƯỚC Mốc 5 và Mốc 4.**
> Căn cứ: `attendance-leave.md` (ADR-119…123, §9), `data-retention.md` (R27), `payroll.md` v3.1 (`tl/m4-payroll-design`, ADR-124…127), `hr-extended.md` v2.1 (`tl/m5-hr-design`, ADR-128…132), `schema.prisma`, `workspace/domain/roles.ts`, module `auth`/`attendance`/`leave`/`notifications`, web `app/(app)/w/…`, nhánh T-053a @62fcc74. Phản biện: A (domain), B (bảo mật), D (nghỉ phép), E (web), F (`docs/reviews/F-company-level-review.md` @76d1b86) — ghi nguồn tại chỗ. Dữ liệu ví dụ là bịa.

**Thay ADR-119 (grants theo workspace) và phần "Một workspace = một công ty" của `attendance-leave.md`.** Luật nghiệp vụ Mốc 3 (tính công, đơn nghỉ, số dư, khóa, luật self, thông báo bền, R27) **giữ nguyên**, chỉ đổi phạm vi từ workspace sang công ty, trừ chỗ ghi rõ.

**v2.1 — TL chốt** (v2 @ 801bf43): Admin **vẫn** tạo workspace và được thêm làm thành viên như mọi người (membership tường minh) — chỉ không có quyền ngầm vào ws không phải thành viên; nâng lên Admin **không** rời ws; ws mồ côi: Admin giao OWNER cho một thành viên hiện có (tự nhận chỉ khi Admin vốn là thành viên ws đó); `member-candidates` gồm Admin đang hoạt động; thêm SEC-HR-69/70 (B HIGH-2a/2b).

**v2 — phản biện A/B/D/E/F + trả lời người dùng** (v1 @ 5bea6a6)
- Người dùng 17/10: **Admin không phải nhân viên** (không chấm công, không xin nghỉ, không phiếu lương); workspace mồ côi ⇒ Admin **giao** cho thành viên còn lại, không tự nhận, 0 thành viên ⇒ lưu trữ; DB local xóa hết + seed lại; tên công ty nhập lúc bootstrap; nhãn UI giữ chữ **"Workspace"**.
- A: nhiệm kỳ lưu bằng **ngày** (`start_date`, `first_day`/`last_day`); nhiệm kỳ chấm công = thời gian có role EMPLOYEE (nâng/hạ Admin đóng/mở nhiệm kỳ); kiểm nhân viên còn hiệu lực **sau khóa**; IN ngoài nhiệm kỳ ⇒ 422; ADJUSTMENT cho người đã nghỉ trong nhiệm kỳ cũ; một nguồn `hireDate`.
- B: nhánh tích hợp `feat/company-level`; refresh + socket + job mỗi phút áp `access_until`; thu hồi phiên theo mẫu ADR-105; Sentry web scrub `/activate`; bootstrap tương tác, token 24 giờ, nâng nhân viên sẵn có; `payroll_settings` bảng riêng; danh bạ email nội bộ (R41); web xử lý 401 `SESSION_REVOKED`; SEC-HR-66…68.
- D: dọn đơn khi nghỉ việc là hành động hệ thống; `AFTER_LAST_DAY`; nhận lại cùng năm; bảng thứ tự khóa toàn cục; index.
- E: trang chính có thẻ chấm công **gọn**, thẻ đầy đủ ở `/attendance`; bỏ thẻ khỏi trang dự án; nút Vào/Ra gọn trên header; header công ty mọi trang; `/activate` ngoài gate; Zalo giữ fragment **chưa kiểm chứng**.
- F: một công ty ⇒ test dùng chung trạng thái — luật cách ly mới; bootstrap mỗi file security; restart API với mốc tiến; ca còn thiếu.

## 0. Quyết định

| Điểm | Ai chốt | Chốt |
|---|---|---|
| TaskFlow phục vụ **một** công ty (công cụ nội bộ), không đa tenant | Người dùng 17/10 | ADR-133 |
| Admin, HR là vai trò **cấp công ty**, thấy ngay ở trang chính sau đăng nhập | Người dùng 17/10 | ADR-134, ADR-139 |
| Workspace **chỉ** để quản lý dự án (dự án, task, bình luận, OWNER/PM/MEMBER/VIEWER); nhãn UI giữ "Workspace" | Người dùng 17/10 | ADR-134, ADR-139 |
| Chấm công, nghỉ phép, lịch, ngày lễ, lương, hồ sơ, vào làm/nghỉ việc thuộc **công ty** | Người dùng 17/10 | ADR-136 |
| Tắt tự đăng ký; chỉ HR/Admin tạo tài khoản (link kích hoạt) | Người dùng 17/10 | ADR-137 |
| Bỏ T-053; chấm công là một thao tác cấp công ty ở trang chính | Người dùng 17/10 | ADR-136, ADR-139 |
| Chưa production ⇒ đổi schema tự do, không chuyển dữ liệu HR | Người dùng 17/10 | ADR-138 |
| **Admin không chấm công, không xin nghỉ, không phiếu lương** — không phải nhân viên | Người dùng 17/10 (Q1) | ADR-134 |
| Admin ngầm có `hr:manage`, `payroll:manage`, `company:grant`, `company:admin` | TL | ADR-134 |
| Workspace mồ côi ⇒ Admin **giao** OWNER cho một thành viên còn lại (Admin chỉ tự nhận nếu vốn đã là thành viên ws đó); không thấy dữ liệu dự án ws mình không là thành viên; 0 thành viên ⇒ Admin **lưu trữ** | Người dùng 17/10 (Q2) | ADR-134 |
| DB local: xóa hết + seed lại, TL chạy sau khi mốc merge vào `main` | Người dùng 17/10 (Q3) | ADR-138 |
| Tên công ty nhập lúc bootstrap, Admin sửa sau | Người dùng 17/10 (Q4) | ADR-137 |
| Bảng `companies` một dòng + `company_members`; **không** cột `companyId` trên bảng nghiệp vụ | TL | ADR-133 |
| Nhiệm kỳ chấm công = **thời gian có role EMPLOYEE**, lưu bằng ngày; tách hẳn membership dự án | TL (A) | ADR-133 |
| **Một** bộ lịch + ngày lễ + múi giờ cho cả công ty (không theo nhóm/chi nhánh ở v1) | TL (A) | ADR-136 |
| Admin tạo workspace và làm thành viên workspace **tường minh** như mọi người; không quyền ngầm vào ws khác; nâng lên Admin **không** rời ws | TL (v2.1) | ADR-134 |
| Mọi nhân viên tạo được workspace; thêm thành viên = chọn từ nhân viên công ty | TL | ADR-134 |
| Admin đầu tiên bằng lệnh CLI tương tác, không bao giờ qua web | TL (B) | ADR-137 |
| Phần lõi ADR-132 (vào làm, kích hoạt, nghỉ việc, nhận lại) chuyển về mốc này | TL | ADR-137, §8 |
| HR **không** đổi vai trò dự án (MEMBER↔PM của ADR-132 bỏ) | TL | ADR-134 |
| Link kích hoạt nhân viên hạn **7 ngày**; link bootstrap **24 giờ** | TL (F, B) | ADR-137 |
| Nghỉ việc có hiệu lực tối đa trễ ~1 phút (job mỗi phút), HTTP/refresh/socket chặn đúng giờ | TL (B) | ADR-135, ADR-137 |
| Bốn vé backend merge vào nhánh tích hợp `feat/company-level`, verify gộp một lần rồi mới vào `main` | TL (B) | §7 |

## 1. Phạm vi

**Có:** công ty một dòng (tên); vai trò Admin / Nhân viên + quyền cấp thêm HR, Kế toán; ma trận quyền công ty tách khỏi workspace; chuyển chấm công/nghỉ phép/lịch/ngày lễ/HrAuditLog/thông báo HR sang công ty; xóa route `/workspaces/:wsId/attendance|leave…`; tắt `/auth/register`; lệnh `admin:bootstrap`; HR/Admin thêm nhân viên (link kích hoạt), cho nghỉ việc có lịch, nhận lại, danh sách nhân viên; Admin: cấp/thu quyền, nâng/hạ Admin, danh sách workspace, giao OWNER / lưu trữ workspace mồ côi; trang chính mới; seed mới; harness test mới.

**Không:** nhiều công ty / chi nhánh / lịch theo nhóm; khách ngoài công ty vào dự án (VIEWER vẫn là vai trò dự án của nhân viên); Admin xem nội dung dự án; email (HR sao chép link); hồ sơ 4 trường, đơn bổ sung giờ, Excel, chính sách phép (Mốc 5); lương (Mốc 4); bỏ lưu trữ workspace.

## 2. ADR đề xuất

**ADR-133 — Một công ty: `companies` một dòng + `company_members`; nhiệm kỳ bằng ngày.**
- `companies(id SMALLINT PK CHECK (id = 1), name, version, updated_at)` — tạo bởi `admin:bootstrap` (seed ở dev). Múi giờ vẫn trong phiên bản lịch (ADR-120).
- `company_members` — **dòng tồn tại ⇔ đang thuộc công ty** (kể cả chờ kích hoạt, đang có lịch nghỉ): `user_id PK`, `role {ADMIN, EMPLOYEE}`, `grants {HR_MANAGE, PAYROLL_MANAGE}[]` (chỉ EMPLOYEE), **`start_date DATE?`** (ngày đầu nhiệm kỳ nhân viên hiện tại; `CHECK (role = 'EMPLOYEE') = (start_date IS NOT NULL)` — Admin không có), `offboard_last_day DATE?` (`CHECK offboard_last_day >= start_date` khi cả hai khác null — D review MEDIUM-1; API `PUT offboarding` trả 422 trước), `offboard_access_until timestamptz?`, `offboard_scheduled_by_id?`, `version`, timestamps; `grants NOT NULL`.
- **Nhiệm kỳ chấm công = thời gian có role EMPLOYEE** (A, TL chốt). `company_member_departures(id, user_id, role, first_day DATE, last_day DATE, left_at timestamptz /*chỉ audit*/, reason {OFFBOARDED, ROLE_CHANGED})` ghi **cùng transaction** khi nhiệm kỳ đóng: nghỉ việc (`OFFBOARDED`) hoặc nâng EMPLOYEE→ADMIN (`ROLE_CHANGED`, `last_day` = **hôm nay** — ngày đổi vẫn tính công). Hạ ADMIN→EMPLOYEE mở nhiệm kỳ mới `start_date` = **ngày mai**. Nâng lên Admin cũng chạy `offboardCleanup` (ADR-137) cho đơn sau `last_day`.
- Domain `tenure.ts` đổi sang `{from: LocalDate, until: LocalDate | null}` (so chuỗi `YYYY-MM-DD`, không instant — A C1). Port `ICompanyTenurePort.tenuresOf({userIds?, from, to})` đọc `company_members WHERE role = 'EMPLOYEE'` + departures (gồm `ROLE_CHANGED`).
- Trạng thái hiển thị **suy ra**: `PENDING_ACTIVATION` (`password_hash IS NULL`), `OFFBOARDING` (`offboard_last_day` khác null), `ACTIVE`, `LEFT` (không dòng, có departure). Hàm thuần ở `company/domain` (Stryker).
- **Không `companyId`** trên bảng nghiệp vụ: một công ty ⇒ cột hằng làm rối mọi unique/index/khóa. Nhiều công ty sau này = **thêm instance + DB riêng**; cần chung DB thì một migration thêm cột vào đúng các bảng ở §3.
- *Bác:* cột role/grants/status trên `users` (trộn auth với HR, không chỗ cho nhiệm kỳ); giữ `workspaceId` làm "công ty" (lỗi người dùng chỉ ra); lưu nhiệm kỳ bằng instant (A: so ngày theo múi giờ dễ lệch, không cần giờ).

**ADR-134 — Vai trò công ty độc lập với vai trò workspace.**

| Vai trò | Là gì | Quyền công ty |
|---|---|---|
| **Admin** (`role = ADMIN`) | Quản trị công ty; ≥ 1 Admin luôn tồn tại; **không phải nhân viên** | `company:admin`, `company:grant`, `hr:manage`, `payroll:manage`, `workspace:create` — **không** `*:self` |
| **HR** (grant `HR_MANAGE`) | Nhân viên được giao nhân sự | quyền nhân viên + `hr:manage` |
| **Kế toán** (grant `PAYROLL_MANAGE`) | Nhân viên được giao lương | quyền nhân viên + `payroll:manage` (Mốc 4) |
| **Nhân viên** (`role = EMPLOYEE`) | Mọi người đang làm | `attendance:self`, `leave:self`, `profile:self` (Mốc 5), `workspace:create` |

- Admin không có thẻ chấm công, không có trong danh sách nhân viên / bảng công / CSV / số dư / bảng lương, trừ những ngày thuộc nhiệm kỳ EMPLOYEE cũ. Route self với Admin ⇒ 403. Luật "OWNER/Admin tự duyệt đơn của mình" **bỏ** (Admin không có đơn); luật self (B-H1) thành tuyệt đối với HR/Kế toán; dữ liệu của HR/Kế toán do người khác có quyền hoặc Admin xử lý. R26 đóng.
- **Không ánh xạ** vai trò công ty ↔ workspace (F#3): Admin **không có quyền ngầm** vào workspace mình không là thành viên (không đọc/sửa dự án ở đó — 404 `workspace` như người ngoài). Admin **vẫn** tạo workspace và được thêm làm thành viên **tường minh** như mọi người (v2.1); khi là thành viên thì quyền theo role ws, như mọi người. Nâng EMPLOYEE→ADMIN **không** rời ws (chỉ đóng nhiệm kỳ chấm công). `member-candidates` gồm Admin đang hoạt động.
- **Workspace mồ côi** (OWNER duy nhất nghỉ việc) — người dùng chốt: `/admin/workspaces` hiện tên, OWNER, số thành viên, cờ mồ côi, đã lưu trữ — **không** dự án/task.
  - `POST /admin/workspaces/:id/owner {userId}`: `userId` phải là **thành viên hiện tại của ws đó** và còn thuộc công ty (EMPLOYEE hoặc ADMIN, không `OFFBOARDING`) — Admin chỉ tự nhận nếu **vốn đã là thành viên** ws đó ⇒ đổi role OWNER (lõi `change-member-role`, phát `member:role-changed`, audit `WORKSPACE_OWNER_ASSIGNED`); ws còn OWNER ⇒ 409 `workspace_has_owner`; không phải thành viên ws / không còn thuộc công ty ⇒ 422 `NOT_WORKSPACE_MEMBER`; ws đã xóa mềm ⇒ 409 `workspace_deleted` (purge tiếp tục — F#7); HR/nhân viên ⇒ 403.
  - Mồ côi và **0 thành viên** ⇒ `POST /admin/workspaces/:id/archive` ⇒ `workspaces.archived_at`; ws lưu trữ không ai thấy, không purge tự động, giữ dữ liệu; còn thành viên ⇒ 409 `workspace_has_members`. Bỏ lưu trữ: không có ở v1.
- **Tạo workspace:** mọi nhân viên đang làm và Admin (người tạo thành OWNER).
- **Thành viên workspace phải thuộc công ty:** `POST /workspaces/:wsId/members {userId, role}`; chọn từ `GET /workspaces/:wsId/member-candidates?q=` (`member:add`; người thuộc công ty — nhân viên và Admin — `ACTIVE` hoặc `PENDING_ACTIVATION` chưa ở ws — gồm chờ kích hoạt **đúng ý**: OWNER thêm người mới vào dự án trước khi họ kích hoạt; không gồm `OFFBOARDING`/`LEFT`; `q` 2..100 ký tự, escape LIKE, limit 20; chỉ `id, fullName, email`; hạn mức 60/giờ/actor). Sai ⇒ 422 `NOT_ACTIVE_MEMBER`. Đây thực chất là danh bạ email công việc nội bộ cho người có `member:add` — chấp nhận (R41, B MEDIUM-4 phương án a).
- Admin: thêm/hạ/cho nghỉ Admin **chỉ Admin khác** làm — Admin không tự hạ / tự cho mình nghỉ (403, F#6); Admin cuối cùng ⇒ 409 `last_admin` (khóa `taskflow:company:admins`). Grant chỉ cho EMPLOYEE; nâng lên ADMIN ⇒ xóa grants cùng transaction.
- `workspace_members` bỏ `grants`; ma trận workspace bỏ `attendance:self`, `leave:self`, `hr:manage`, `hr:grant`.

**ADR-135 — Ma trận quyền công ty riêng; middleware; hết quyền đúng giờ.**
- Module `company`: `company/domain/roles.ts` (TS thuần) — `COMPANY_PERMISSIONS`, `COMPANY_ROLE_PERMISSIONS`, `COMPANY_GRANT_PERMISSIONS`, `effectiveCompanyPermissions(role, grants)`; bản dữ liệu thuần trong `packages/contracts`, parity như ADR-080: `HR_MANAGE` = `{hr:manage}`, `PAYROLL_MANAGE` = `{payroll:manage}`; không grant nào chứa `company:*`; ADMIN ∌ `*:self`; quyền công ty ∩ quyền ws = ∅. `hr:grant` ⇒ **`company:grant`**.
- Hàm thuần `accessUntilOf(lastDay, timezone)` (06:00 ngày sau, giờ chốt ngày công A#7) và `isCompanyAccessActive(member, now)` ở `company/domain` (Stryker, F §4).
- `loadCompanyMember` cho router `/api/v1/{attendance,leave,hr,admin,company,payroll,payslips}` và `POST /workspaces`: một truy vấn theo `userId`, không cache. **Áp cùng điều kiện `access_until` ở:** `loadCompanyMember`, `loadMembership` của workspace (JOIN `company_members` cùng câu truy vấn), **`/auth/refresh`**, socket gateway (handshake + join phòng), `WorkspaceProjectAccessChecker` (B HIGH-2). Socket đã nối được cắt bởi job hoàn tất **mỗi phút** ⇒ trễ tối đa ~1 phút (R40).
- Thứ tự lỗi: chưa đăng nhập 401 → **không thuộc công ty / hết `access_until` ⇒ 401 `SESSION_REVOKED`** (kể cả access token cũ còn hạn — F) → thiếu quyền 403 (`permit` TRƯỚC validate) → 400 → 404 → 422/409. Chưa có Admin nào (sau migrate) ⇒ route `company:admin` 403, không 500. Web coi 401 `SESSION_REVOKED` là **hết phiên** (về `/login`), không vào vòng refresh (B MEDIUM-6).
- Lệnh ghi `hr:manage`/`payroll:manage`/`company:*` qua `authorizeCompanyWrite({actorId, targetUserId?, reason?})`: khóa dòng `company_members` của actor FOR SHARE, đọc lại role + grants (B-H3). Lệnh của nhân viên (chấm công, đơn nghỉ) gọi `ICompanyAccess.assertActiveEmployee(userId)` **sau khóa nghiệp vụ** (`punch:<user>` / `leave:<user>`): có dòng + `role = 'EMPLOYEE'` + `access_until > now`, khóa FOR SHARE — không thì 401 `SESSION_REVOKED` (A C2).
- `/auth/me` thêm `company: {name, role, grants, permissions, status, offboardLastDay}`; event `company:access-changed {role, grants}` tới `user:{id}` (thay `member:grants-changed` — không còn phát).

**ADR-136 — Chấm công, nghỉ phép, lịch, ngày lễ, HrAuditLog, thông báo HR thuộc công ty.**
- Bỏ `workspace_id` khỏi mọi bảng Mốc 3 (§3). Purge workspace **không còn** xóa dữ liệu HR.
- **Nhân viên** = `role = EMPLOYEE` có dòng hiệu lực (A#5), không phụ thuộc role ws.
- **Một** bộ lịch có phiên bản + ngày lễ + múi giờ cho cả công ty (A#4).
- **Tái dùng gần nguyên** (A#3): `summarizeDay`, `work-date`, `summarizeUsers`, totals T-046, gộp AM+PM T-052, retention T-047, luật đơn/số dư/máy trạng thái §9; `punch-rules.ts` + `lockUserPunch` cherry-pick từ 62fcc74 rồi bỏ `workspaceId`. `tenure.ts` đổi sang ngày (ADR-133). `IHrAccess` ⇒ `ICompanyAccess` (`authorizeWrite`, `isEmployee`, `assertActiveEmployee`).
- **Luật mới theo nhiệm kỳ** (A):
  - IN đòi `workDate` thuộc nhiệm kỳ hiện tại ⇒ không thì 422 `NOT_EMPLOYED` (chặn IN trước `start_date`); OUT giữ luật 06:00.
  - ADJUSTMENT/void của HR cho người **đã nghỉ** được nếu `date` thuộc một nhiệm kỳ cũ và trong hạn retention; ngoài ⇒ 422 `NOT_EMPLOYED` / `OUTSIDE_RETENTION`.
  - Đã có lịch nghỉ: submit / approve / preview đơn có ngày > `offboard_last_day` ⇒ 422 `AFTER_LAST_DAY` (D H1).
- **Nhận lại cùng năm** (D H2): số dư năm Y chỉ tính đơn có `startDate ≥ start_date` nhiệm kỳ hiện tại; `adjustmentDays` năm Y **reset** về 0 lúc nhận lại (audit `BALANCE_ADJUST` có before/after). Nhiệm kỳ trước thuộc năm khác ⇒ như người mới.
- **Danh sách số dư** (D M3) gồm đang làm + sắp nghỉ + chờ kích hoạt; `PATCH leave/balances/:userId/:year` cho người **từng** là nhân viên (có nhiệm kỳ giao năm đó).
- Khóa: `taskflow:attendance:punch:<user>`, `taskflow:leave:<user>`, payroll `taskflow:payroll:<period>`. **Thứ tự toàn cục** (D M1) — mọi use case lấy theo đúng thứ tự, bỏ bước không cần:

| # | Khóa | Loại |
|---|---|---|
| 1 | `taskflow:leave-policy` (Mốc 5) | advisory, shared/exclusive |
| 2 | `taskflow:company:admins` | advisory, shared (exclusive khi đổi Admin) |
| 3 | `taskflow:leave:<user>` | advisory xact |
| 4 | `taskflow:attendance:punch:<user>` | advisory xact |
| 5 | dòng `company_members` (actor rồi target, theo `user_id` tăng dần) | row FOR SHARE / FOR UPDATE |
| 6 | owner-guard từng workspace theo `id` tăng dần | row |

- Unique một phần: `(user_id, work_date) WHERE kind='IN' AND source='WEB' AND voided_at IS NULL`; `(user_id, source, idempotency_key) WHERE idempotency_key IS NOT NULL`. Index đơn nghỉ (D M2): `(status, start_date, id)`, `(status, created_at, id)`, `(user_id, start_date)`.
- Thông báo: bỏ `workspace_id`; audience HR = nhân viên có `hr:manage` hiện tại + Admin (lọc lúc đọc, B-H3); DTO bỏ `workspaceName`; `HR_GRANTED/HR_REVOKED` ⇒ `ACCESS_CHANGED`.
- HrAuditLog bỏ `workspace_id`; **chỉ Admin đọc**. Sửa lịch / ngày lễ quá khứ: chỉ Admin (ADR-121).
- Route cũ `/workspaces/:wsId/attendance/*`, `…/leave-requests*`, `…/leave-balances*`, `…/members/:userId/grants`, `…/hr-audit-logs`, `/me/attendance` (T-053a) **bị xóa**.

**ADR-137 — Tài khoản: tắt tự đăng ký, Admin bootstrap, thêm nhân viên bằng link kích hoạt, nghỉ việc cấp công ty.**
- **Tắt đăng ký:** xóa `POST /auth/register` (⇒ 404 chung, không lộ email), use case, limiter `register`, trang `/register` + mọi link. Ô mật khẩu (gợi ý chính sách) tách thành component dùng chung **trước** khi xóa trang (E B4). Bác cờ env "mặc định tắt".
- **Admin đầu tiên:** `pnpm --filter @taskflow/api admin:bootstrap` (production `node dist/cli/admin-bootstrap.js`). Đọc `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `COMPANY_NAME`; thiếu ⇒ thoát lỗi, **không bao giờ** tạo admin mặc định. **Chỉ chạy tương tác** (TTY, hỏi xác nhận — B MEDIUM-2); `--json` không tương tác **chỉ** khi `APP_ENV=test` (cùng chốt của `TEST_CLOCK_ANCHOR`; production cấm `APP_ENV=test`) cho harness. Trong một transaction dưới khóa `taskflow:company:admins`:
  - đã có Admin ⇒ thoát 1, báo "Đã có Admin — không làm gì": không tạo Admin thứ hai, không đổi mật khẩu ai;
  - email mới ⇒ tạo `companies` (nếu chưa có) + user chờ kích hoạt + `company_members(ADMIN)` + token **24 giờ**, in link;
  - email là nhân viên đã có mật khẩu ⇒ **nâng lên ADMIN** (đóng nhiệm kỳ `ROLE_CHANGED` như ADR-133, không đổi mật khẩu, không token, audit actor `CLI`);
  - `--reissue-link`: chỉ khi mọi Admin còn chờ kích hoạt ⇒ link 24 giờ mới, thu hồi link cũ.
  - Đọc `TEST_CLOCK_ANCHOR` (giờ nghiệp vụ) cho `expires_at` — F.
- **Thêm nhân viên** (`POST /hr/employees`, `hr:manage`, một transaction): `{email, fullName, startDate?}` ⇒ email mới: user `password_hash NULL` + `company_members(EMPLOYEE, start_date)` + token 7 ngày; người đã nghỉ ⇒ **nhận lại** (nhiệm kỳ mới; có mật khẩu cũ ⇒ đăng nhập được ngay bằng mật khẩu cũ, không token; phiên cũ **không** sống lại — đã thu hồi lúc nghỉ); đang thuộc công ty ⇒ 409 `already_employee`; tài khoản đã xóa ⇒ 422 `EMAIL_UNAVAILABLE`. `startDate` mặc định hôm nay, lùi ≤ 31 ngày, không tương lai; UI cảnh báo "N ngày làm việc trước hôm nay sẽ là vắng — nhập bù ở Bảng công" (A S3, TL chốt). HR không tạo Admin, không cấp grant (strict ⇒ 400). Response 201 `{employee: {userId, status, version, startDate}, accountCreated, activation?: {link, expiresAt}}` (F — harness cấp grant không cần GET). Hạn mức 30/giờ/actor.
- **Token kích hoạt** (điều khoản bắt buộc — F):
  1. 32 byte ngẫu nhiên base64url; DB chỉ lưu SHA-256; token **chỉ một lần** trong response "thêm" / "tạo lại link" cho người tạo, `Cache-Control: no-store`; không route GET đọc lại.
  2. Một lần; hạn 7 ngày (bootstrap 24 giờ); "tạo lại link" thu hồi token cũ **ngay**; mỗi user ≤ 1 token sống.
  3. Không trong log (pino redact), Sentry **API và web** (web: `beforeSend`/`beforeBreadcrumb` xóa fragment + query của URL `/activate`, hoặc không init Sentry trên trang đó — B MEDIUM-1), audit (chỉ `ACTIVATION_LINK_ISSUED`), thông báo, URL API. Link `<WEB_ORIGIN>/activate#t=<token>`; token đi trong **body** POST.
  4. **Mở trang không tiêu token:** GET `/activate` và việc trang tải không đổi trạng thái (bot xem trước của Zalo/Messenger/Slack); `POST /auth/activation/inspect {token}` chỉ đọc ⇒ `{fullName, email, companyName}` (lộ tên người chủ token — chấp nhận, cần token 256 bit; F); chỉ `POST /auth/activate {token, password}` tiêu token: `PasswordPolicy` (kèm email), một transaction đặt `password_hash` + `used_at` (`UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now()` đếm 1) ⇒ phiên mới; mật khẩu yếu ⇒ 422, token **vẫn sống**.
  5. Token sai/đoán ⇒ cùng một 400 `ACTIVATION_INVALID` + hạn mức IP; đã dùng / hết hạn / thu hồi ⇒ 410 `ACTIVATION_GONE`; web cùng một câu "Link không còn hiệu lực — xin bộ phận nhân sự link mới".
- **Trang `/activate`** (E): ngoài `GuestGate`/`AuthGate`; đọc fragment → state → `history.replaceState` **trước mọi request**; tải lại mất token ⇒ "Hãy mở lại link trong tin nhắn"; đang có phiên ⇒ "Bạn đang đăng nhập là X — Đăng xuất để kích hoạt"; ô `username` ẩn `autocomplete="username"` mang email (trình quản lý mật khẩu); `Referrer-Policy: no-referrer`; tên hiển thị là text (XSS).
- **Chưa kiểm chứng (E B6):** trình duyệt trong Zalo có giữ fragment `#` khi mở link không. **Việc bắt buộc trước deploy:** thử trên điện thoại thật (Android + iOS). Dự phòng: token trong path `/activate/<token>`, GET vẫn chỉ đọc, không tiêu; khi đó thêm redact path ở proxy/log.
- **Không mở lỗ:** login với `password_hash IS NULL` ⇒ như không có user (hash giả, cùng thời gian — LOG-04); login/refresh của người không còn dòng `company_members` hoặc hết `access_until` ⇒ như sai thông tin / 401; không có quên mật khẩu (thêm sau phải loại user chờ kích hoạt).
- **Cho nghỉ việc có lịch** (`PUT/DELETE /hr/employees/:userId/offboarding {lastDay, reason?}`): `lastDay ∈ [hôm nay − 31, hôm nay + 90]`; `access_until = accessUntilOf(lastDay)`. HR không tác động chính mình, Admin, người giữ grant ⇒ 403 (Admin làm). Response cảnh báo đơn chờ + ws mà người đó là OWNER duy nhất; thông báo `OFFBOARD_SCHEDULED` cho nhân viên + Admin; web hiện dải "Bạn làm việc tới hết ngày dd/mm" (E A6).
- **Hoàn tất** (job **mỗi phút**, advisory lock, theo lô, idempotent, partial index `offboard_access_until`; hoặc ngay trong request khi `access_until ≤ now`), một transaction theo thứ tự khóa ADR-136:
  0. **lấy `taskflow:leave:<U>` rồi `taskflow:attendance:punch:<U>` TRƯỚC khi đụng dòng `company_members`** (bậc 3 trước bậc 5 — D review HIGH-1, TL 17/10; cùng thứ tự cho nâng EMPLOYEE→ADMIN). Hook `offboardCleanup` / `resetOnRehire` lấy lại khóa leave là tái nhập, vô hại. Integration 2 kết nối: submit ‖ hoàn tất không deadlock;
  1. `DELETE FROM company_members WHERE user_id = $1 AND offboard_access_until <= $now RETURNING …` (`$now` = đồng hồ nghiệp vụ của ứng dụng, **không** `now()` của DB — D review MEDIUM-2, khớp `isCompanyAccessActive` dưới `TEST_CLOCK_ANCHOR`) — **đếm 1** mới đi tiếp (request ‖ job ⇒ đúng một departure — F);
  2. ghi departure `OFFBOARDED` (`last_day`, `left_at`);
  3. `endMembership` ở mọi workspace (port `IWorkspaceExitPort`, adapter ở workspace);
  4. **`offboardCleanup`** — hành động hệ thống qua port của leave (D H1): PENDING mọi ngày ⇒ CANCELLED; APPROVED `startDate > lastDay` ⇒ REVOKED (bỏ qua điều kiện `onlyBeforeStart`); vắt qua `lastDay` giữ nguyên (đếm khi đọc cắt theo nhiệm kỳ); `decidedBy` = người lên lịch nghỉ, ghi chú "Nghỉ việc — hệ thống", audit; **một** thông báo tổng cho HR;
  5. thu hồi token kích hoạt sống;
  6. **thu hồi phiên theo mẫu ADR-105** (B HIGH-3): trong transaction tăng `token_version` + `revokeAllForUser('OFFBOARDED')` + `setTokenVersion` lên Valkey **trước commit** (lỗi ⇒ rollback, job thử lại lượt sau); **sau commit** `disconnectUser`. Cùng mẫu áp cho Admin hạ Admin và nâng EMPLOYEE→ADMIN (phiên cũ mang quyền cũ).
- **Không xóa vĩnh viễn trên UI** (giữ ADR-132).

**ADR-138 — Migration một lần, không chuyển dữ liệu HR; seed viết lại; DB local reset.**
- Migration 5 `company_level`: enum/bảng công ty, `users.password_hash` DROP NOT NULL, `workspaces.archived_at`, **DROP + CREATE** lại `work_schedules`, `holidays`, `attendance_events`, `leave_requests`, `leave_balances`, `notifications`, `hr_audit_logs` không `workspace_id` (không giữ dữ liệu — A#2); DROP `workspace_member_departures`, `workspace_members.grants`, enum `MemberGrant`. CHECK/partial unique bằng SQL tay. `grant-app.sql` đủ.
- **Backfill tối thiểu** (cho DB CI/dev khác): `INSERT INTO company_members (user_id, role, start_date) SELECT id, 'EMPLOYEE', (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date FROM users WHERE deleted_at IS NULL` — user đã xóa mềm **không** backfill; không có Admin ⇒ `admin:bootstrap`.
- **Seed mới** (chặn production): công ty "Công ty Mẫu" · Olivia **Admin** (không chấm công) · Pam **HR** · Max **Kế toán** · Mia, Vic, Otto nhân viên · Nina **chờ kích hoạt** (seed in link) · Quinn **đã nghỉ** (departure, có công tháng trước) · 2 workspace mẫu (Olivia là thành viên một ws, không ở ws còn lại — minh họa không có quyền ngầm) · lịch mặc định, 2 ngày lễ bịa, vài lượt chấm + đơn nghỉ.
- **DB local của người dùng** (người dùng đồng ý xóa hết, Q3): **TL chạy sau khi mốc merge vào `main`**, báo trước khi chạy, trên DB dev cổng 5435 (không đụng DB test 5434):
  `pnpm --filter @taskflow/api exec prisma migrate reset --force` rồi `pnpm --filter @taskflow/api db:seed`.
  Mất toàn bộ dữ liệu local (tài khoản, workspace, dự án, task, chấm công, đơn nghỉ, số dư, lịch, ngày lễ, thông báo, audit), thay bằng dữ liệu mẫu.

**ADR-139 — Trang chính `/w` theo vai trò; trang công ty không có `wsId`.**
- Route công ty ở gốc: `/attendance`, `/leave`, `/hr` (+ `/hr/employees`), `/admin` (`/admin/access`, `/admin/workspaces`, `/admin/company`), `/payslips`, `/payroll` (Mốc 4), `/activate`. `/w/[wsId]` chỉ còn dự án/board/settings. Xóa `/w/[wsId]/{attendance,leave,hr}`, `/register`. Nhãn UI giữ **"Workspace"**.
- **Header công ty** trên mọi trang (E A4): tên công ty + link "Trang chính" (`/w`) + chuông; ≥ md: link "Nhân sự" (`hr:manage`), "Bảng lương" (`payroll:manage`), "Quản trị" (`company:admin`); < md: nút ☰. Nút **Vào/Ra gọn** trên header mọi trang ≥ sm (nhân viên; Admin không có).
- `/w` ở 360 px, từ trên xuống (E A1/A2): (1) **thẻ chấm công gọn** (~260 px, một nút Vào/Ra, giờ server, trạng thái hôm nay — tái dùng card-frame, `CheckInPrompt`) — thẻ đầy đủ ở `/attendance`; (2) khối **"Việc quản lý"** ô lớn theo quyền (Nhân sự, Bảng lương, Quản trị); (3) lối tắt "Bảng công của tôi", "Xin nghỉ", "Phiếu lương" (ẩn tới Mốc 4); (4) **"Workspace của bạn"** + "Tạo workspace". Admin: không thẻ chấm công, không lối tắt self; có "Việc quản lý" và "Workspace của bạn" (ws Admin là thành viên tường minh).
- **Bỏ thẻ chấm công khỏi `/w/[wsId]/projects`** (E A3); E2E-HR-14 chuyển sang đo `/w`.
- Trang Thành viên ws: bỏ công tắc "Quản lý nhân sự"; "Thêm thành viên" là combobox nhân viên (`member-candidates`).
- `/hr`: bảng công tháng và hàng đợi đơn có **ô tìm theo tên** (F §1).
- Cache: gốc key `['company', …]`; xóa khi đăng xuất, khi 401 `SESSION_REVOKED`, khi `company:access-changed` mất quyền. Hook `useCompanyPermission(p)`. ~25 component chỉ đổi URL.

**ADR-140 — Harness test: tạo người qua đường production; luật cách ly khi một công ty** (F; giữ T-026: seed qua API công khai, không chèn DB, không route test-only).
- **Bootstrap:** security (DB riêng mỗi file, reset mỗi file) chạy `admin:bootstrap --json` trong `beforeAll` **sau** reset; E2E chạy một lần ở `globalSetup`. CLI nhận cùng `DATABASE_URL` + `TEST_CLOCK_ANCHOR` của suite, xuất `{link, userId}`; harness `activate` ⇒ phiên Admin.
- `Actors.createUser(label, {grants?, admin?, workspace?})`: Admin `POST /hr/employees` ⇒ `activate` (lấy luôn access token, không login lại) ⇒ (tùy chọn) `PUT /admin/access/:userId` với `version` từ response ⇒ OWNER thêm vào ws. Harness gọi `flushRateLimitCounters` trước mỗi vòng (như với register). `newWorkspace(owner)` tường minh; `defaultWorkspaceId`, alias `register` bỏ dần.
- **Restart API với mốc tiến** trên cùng DB (CLK-HR-06/09): đồng hồ test chấp nhận process mới có mốc **sau** dữ liệu đã ghi — không kiểm "mốc < dữ liệu" nào làm API từ chối khởi động (ràng buộc cho A).
- **Một công ty ⇒ trạng thái dùng chung** (F §1): security đặt ca đổi lịch/ngày lễ ở file riêng; E2E **cấm** đổi lịch công ty, ngày lễ chỉ dùng ngày xa qua helper `reserveDate()`; suite E2E HR chạy `workers: 1` (cả CI) **và** khẳng định thông báo theo delta lọc `refId`; ca tìm người qua ô tìm, không dựa trang 1; `test-spec-hr.md` §0 thêm: "mỗi ca tự tạo người; không khẳng định số dòng tuyệt đối của danh sách toàn công ty".
- Cách ly tenant chỉ còn ở **workspace dự án** (ADR-020 giữ); ca cách ly HR W1/W2 (vd SEC-HR-01) viết lại thành phân quyền trong công ty; "OWNER ws có hr:manage" ⇒ hai actor (Admin/HR cho HR, OWNER cho dự án).

## 3. Dữ liệu — migration 5 `company_level`

```
enum CompanyRole        { ADMIN EMPLOYEE }
enum CompanyGrant       { HR_MANAGE PAYROLL_MANAGE }        -- PAYROLL_MANAGE dùng từ Mốc 4; khai sẵn cho parity
enum DepartureReason    { OFFBOARDED ROLE_CHANGED }         -- thay MemberDepartureReason
enum RefreshTokenRevokeReason + OFFBOARDED
enum NotificationType   − HR_GRANTED HR_REVOKED  + ACCESS_CHANGED OFFBOARD_SCHEDULED OFFBOARD_CLEANUP
DROP enum MemberGrant

companies               (id SMALLINT PK CHECK id = 1, name VarChar(100) CHECK btrim(name) <> '', version, updated_at)
company_members         (user_id PK → users Restrict, role, grants CompanyGrant[] DEFAULT '{}', start_date Date?,
                         offboard_last_day Date?, offboard_access_until Timestamptz(3)?,
                         offboard_scheduled_by_id? → users Restrict, version, created_at, updated_at)
                         CHECK (role = 'EMPLOYEE') = (start_date IS NOT NULL)
                         CHECK role = 'EMPLOYEE' OR grants = '{}'
                         CHECK 3 cột offboard cùng NULL / cùng khác NULL
                         INDEX (offboard_access_until) WHERE offboard_access_until IS NOT NULL   -- job mỗi phút
                         INDEX (role)                                                            -- last-admin guard
company_member_departures (id, user_id → users Restrict, role, first_day Date, last_day Date, left_at Timestamptz(3),
                         reason)  CHECK last_day >= first_day;  INDEX (user_id), INDEX (last_day)
account_activation_tokens (id, user_id → users Cascade, token_hash Char(64) UNIQUE, expires_at, used_at?, revoked_at?,
                         created_by_id? → users Restrict  -- NULL = do admin:bootstrap cấp
                         , created_at)
                         UNIQUE (user_id) WHERE used_at IS NULL AND revoked_at IS NULL; INDEX (expires_at)
users                   password_hash DROP NOT NULL (NULL = chờ kích hoạt)
workspaces              + archived_at Timestamptz(3)?  (Admin lưu trữ ws mồ côi 0 thành viên)
workspace_members       − grants
DROP workspace_member_departures

-- Tạo lại không workspace_id (cột còn lại như schema hiện tại):
work_schedules          UNIQUE (effective_from)
holidays                PK (date)
attendance_events       INDEX (work_date), (user_id, work_date); 2 partial unique như ADR-136
leave_requests          INDEX (status, start_date, id), (status, created_at, id), (user_id, start_date)
leave_balances          PK (user_id, year)
notifications           INDEX (recipient_id, read_at, created_at)
hr_audit_logs           INDEX (created_at DESC, id DESC); action + COMPANY_ROLE_SET GRANT_SET EMPLOYEE_HIRED
                          EMPLOYEE_REHIRED EMPLOYEE_OFFBOARD_SCHEDULED EMPLOYEE_OFFBOARD_CANCELLED
                          EMPLOYEE_OFFBOARD_COMPLETED OFFBOARD_CLEANUP ACTIVATION_LINK_ISSUED
                          WORKSPACE_OWNER_ASSIGNED WORKSPACE_ARCHIVED   (GRANT/REVOKE cũ bỏ)
```
FK user giữ `Restrict`. Bảng HR không còn FK tới `workspaces`. `payroll_settings` **không** ở đây — bảng riêng PK hằng `id = 1` do module payroll sở hữu, tạo ở migration payroll (B MEDIUM-3, §8).

## 4. API (`/api/v1/…`, contracts Zod `.strict()` + OpenAPI)

Luật, hạn mức, header của từng route **giữ như `attendance-leave.md` §5, §9**, chỉ đổi đường dẫn và quyền.

| Route mới | Quyền | Thay cho |
|---|---|---|
| `GET attendance/me/today` · `POST attendance/check-in` · `POST attendance/check-out` · `GET attendance/me?month` · `GET attendance/me/events?date` | `attendance:self` (Admin 403) | `workspaces/:wsId/attendance/…`, `POST /me/attendance` |
| `GET attendance/today` · `GET attendance?month&q` · `GET attendance/export.csv` · `GET/POST attendance/events…` | `hr:manage` | như trên |
| `GET/POST attendance/schedules` · `GET/PUT/DELETE attendance/holidays/:date` | đọc: nhân viên + `hr:manage` · ghi: `hr:manage` (quá khứ: Admin) | như trên |
| `POST leave/requests` · `GET leave/requests?mine=1` · `GET leave/requests/preview` · `POST leave/requests/:id/cancel` · `GET leave/balances/me` | `leave:self` (Admin 403) | `…/leave-requests`, `…/leave-balances/me` |
| `GET leave/requests?status&q` · `POST leave/requests/:id/{approve,reject,revoke}` · `GET leave/balances` · `PATCH leave/balances/:userId/:year` | `hr:manage` | như trên |
| `GET hr/employees?status=active\|pending\|offboarding\|left&q&cursor` · `POST hr/employees` · `POST hr/employees/:userId/activation-link` · `PUT/DELETE hr/employees/:userId/offboarding` | `hr:manage` | ADR-132 (bỏ `PATCH` vai trò dự án) |
| `GET hr/audit-logs?cursor` | `company:admin` | `…/hr-audit-logs` |
| `GET admin/access` · `PUT admin/access/:userId {role, grants, expectedVersion}` | `company:admin` / `company:grant` | `PUT …/members/:userId/grants` |
| `GET admin/workspaces` · `POST admin/workspaces/:id/owner {userId}` · `POST admin/workspaces/:id/archive` | `company:admin` | mới |
| `GET company` · `PATCH company {name, expectedVersion}` | thuộc công ty · `company:admin` | mới |
| `GET workspaces/:wsId/member-candidates?q` · `POST workspaces/:wsId/members {userId, role}` | `member:add` | `{email, role}` |
| `POST auth/activation/inspect` · `POST auth/activate` | công khai (origin cho phép, hạn mức IP) | mới |
| `POST auth/register` | — | **xóa** ⇒ 404 |
| `GET me/notifications…` | đăng nhập | bỏ lọc "ws còn là thành viên" |

`userId` trong route HR: chưa từng có nhiệm kỳ EMPLOYEE ⇒ 404 `user`; người đã nghỉ vẫn xem/xuất được công (R30).

## 5. Bảo mật (B) — ca SEC cho F

Dải: SEC-HR-30…39 (T-053 lấy lại + 36…39 trống — F đã kiểm không trùng), SEC-HR-56…65 (chuyển từ Mốc 5, giữ số), SEC-HR-66…70 (B).

| Mã | Ca | Mong đợi |
|---|---|---|
| SEC-HR-30 | Leo quyền: nhân viên / HR / Kế toán `PUT admin/access/:self` hoặc người khác; body có `role` khi `POST hr/employees` | 403; 400 strict |
| SEC-HR-31 | HR cấp/thu HR, Kế toán, Admin; HR cho nghỉ / tạo lại link cho Admin, chính mình, người giữ grant | 403; Admin làm được |
| SEC-HR-32 | Admin tự hạ / tự cho mình nghỉ (còn Admin khác); hạ / cho nghỉ Admin cuối cùng | 403; 409 `last_admin`; Admin khác làm được |
| SEC-HR-33 | Thu `HR_MANAGE` ⇒ request kế tiếp 403 ngay; lệnh ghi đang mở sau khóa 403, không ghi | đúng |
| SEC-HR-34 | Parity: grant ∌ `company:*`; `HR_MANAGE` ∌ `payroll:*`; `PAYROLL_MANAGE` ∌ `hr:*`; ADMIN ∌ `*:self`; ws ∩ công ty = ∅ | đúng |
| SEC-HR-35 | Nhân viên gọi route `hr:manage`/`company:admin` với body sai; đọc công/đơn/số dư người khác; HR gọi `hr/audit-logs`; **Admin** gọi `attendance/check-in`, `leave/requests` (self) | 403 (không 400); 403; 403; 403 |
| SEC-HR-36 | IDOR id đơn / lượt chấm / thông báo người khác qua route self; `userId` chưa từng là nhân viên trong route HR | 404 |
| SEC-HR-37 | Thêm thành viên ws: `userId` không thuộc công ty / sắp nghỉ / đã nghỉ (Admin đang hoạt động ⇒ được); `member-candidates` bởi MEMBER; `q` `%`/`_`/`\`, 1 000 ký tự; lần 61/giờ | 422; 403; khớp chữ thường; 400; 429 |
| SEC-HR-38 | Admin gọi route dự án của ws **không** là thành viên; ws Admin là thành viên ⇒ theo role ws; `admin/workspaces` chỉ trả tên/OWNER/số thành viên; `owner` với `userId` ngoài ws (gồm Admin tự nhận khi không là thành viên) / ws còn OWNER / ws xóa mềm; `archive` ws còn thành viên; nâng lên Admin ⇒ membership ws giữ nguyên | 404 `workspace`; đúng; đúng; 422 / 409 / 409; 409; đúng |
| SEC-HR-39 | `POST auth/register`; `GET /register` (web); route cũ `/workspaces/:wsId/attendance/*`, `…/leave-requests`, `…/members/:id/grants`, `/me/attendance`; `member:grants-changed` không còn phát | 404; không trang; 404; đúng |
| SEC-HR-56 | Token dùng lần 2 / hết hạn / thu hồi khi tạo lại ⇒ 410 `ACTIVATION_GONE`; token sửa 1 ký tự / rác ⇒ 400 `ACTIVATION_INVALID`, body giống nhau | đúng |
| SEC-HR-57 | 11 lần sai/15 phút/IP vào `activate` và `inspect`; thời gian đáp không phân biệt (trung vị, LOG-04) | 429; đúng |
| SEC-HR-58 | User chờ kích hoạt: `login` (mọi mật khẩu, kể cả rỗng), `refresh`; người đã nghỉ: `login`, `refresh` bằng refresh token cũ, access token cũ | như user không tồn tại; 401 / 401 `SESSION_REVOKED` |
| SEC-HR-59 | Token không có trong audit, thông báo, log pino, Sentry API **và web** (sự kiện ném lỗi trên `/activate`), `GET hr/employees`, URL API; response có `no-store`; không route GET đọc lại; `/activate` xóa fragment, `no-referrer` | đúng |
| SEC-HR-60 | Bot xem trước: GET trang `/activate#t=…` 5 lần + `inspect` 5 lần ⇒ token vẫn `activate` được | đúng |
| SEC-HR-61 | Mật khẩu yếu ⇒ 422, token vẫn sống; thành công ⇒ phiên mới, token chết | đúng |
| SEC-HR-62 | Sau `access_until`, trước job: route công ty 401 `SESSION_REVOKED`, route ws 404, `refresh` 401, socket handshake/join bị từ chối; socket đã nối mở trước 06:00 ⇒ bị ngắt ≤ ~1 phút, không nhận event dự án sau khi bị ngắt | đúng |
| SEC-HR-63 | Thêm nhân viên lần 31/giờ; tạo lại link lần 11/giờ | 429 |
| SEC-HR-64 | Bootstrap: lần 2 khi đã có Admin ⇒ thoát 1, không đổi gì; thiếu env ⇒ thoát lỗi, không user; không TTY và không `APP_ENV=test` ⇒ từ chối; `--reissue-link` khi Admin đã kích hoạt ⇒ thoát 1; email nhân viên có mật khẩu ⇒ nâng ADMIN, mật khẩu giữ, không token | đúng |
| SEC-HR-65 | Body strict: `POST hr/employees` có `grants`/`role`/`startDate` tương lai/`userId`; `PUT admin/access` có `startDate` | 400 / 422 |
| SEC-HR-66 | Thu hồi phiên (nghỉ việc, Admin hạ Admin, nâng lên Admin): Valkey `setTokenVersion` lỗi ⇒ rollback, không departure, job thử lại; thành công ⇒ access token cũ 401 ngay, socket bị `disconnectUser` | đúng |
| SEC-HR-67 | Web: 401 `SESSION_REVOKED` ⇒ về `/login`, xóa cache `['company']`, không gọi `refresh` lặp | đúng |
| SEC-HR-68 | Nhận lại: phiên/refresh token cũ không sống lại; mật khẩu cũ đăng nhập được; trước khi nhận lại login như không tồn tại | đúng |
| SEC-HR-69 | (B HIGH-2a) `POST /auth/refresh` bằng refresh token **còn hạn** trong khe sau `access_until`, trước khi job hoàn tất | 401, không cấp access token mới, không xoay token |
| SEC-HR-70 | (B HIGH-2b) Socket đã join phòng ws và `user:{id}` trước `access_until`: bị ngắt trong ≤ ~1 phút (job mỗi phút + `disconnectUser`); event dự án phát sau khi ngắt không tới; nối lại ⇒ handshake bị từ chối | đúng |

Threat-model §6 (B): **R27** chủ thể "nhân viên công ty" (job retention bỏ ws; **D5** ⇒ `company_member_departures` theo `last_day`; **D10** token, **D11** tài khoản chờ kích hoạt — B MEDIUM-5) · **R26** đóng (không ai tự duyệt) · **R30** "người đã nghỉ việc" · **R36** thu hẹp · mới **R37** Admin toàn quyền nhân sự/lương — nhiều Admin, audit Admin đọc, không ngầm quyền dự án · **R38** ai có shell/DB chạy được `admin:bootstrap` (chấp nhận: cùng mức tin cậy hạ tầng; tương tác, từ chối khi đã có Admin) · **R39** workspace mồ côi: Admin chỉ giao OWNER cho thành viên hiện có (tự nhận chỉ khi vốn là thành viên) hoặc lưu trữ khi 0 thành viên — **không** thấy dữ liệu dự án ws mình không là thành viên; rủi ro còn lại: Admin chọn sai người được giao (audit) · **R40** socket đã nối nhận event dự án tối đa ~1 phút sau `access_until` · **R41** `member-candidates` là danh bạ email công việc nội bộ cho người có `member:add` (hạn mức 60/giờ).

## 6. Test (F cập nhật `test-spec-hr.md`; tầng như §0.1)

Dải: CC-HR-16…19 + CC-HR-26…27 (chuyển từ Mốc 5), CLK-HR-05…09, E2E-HR-15…19.

- **CO**: CO-01 `effectiveCompanyPermissions` + parity; CO-02 trạng thái suy ra + `accessUntilOf`/`isCompanyAccessActive` (Stryker `company-domain` ≥ 90 %); CO-03 tenure ngày: vào → nghỉ → nhận lại = 2 đoạn, giữa = NOT_EMPLOYED; CO-04 hoàn tất: `DELETE … RETURNING` đếm 1, departure đúng, rời mọi ws, ws mồ côi gắn cờ, `offboardCleanup` đủ 3 nhánh + một thông báo tổng, thu hồi phiên **3 bước** (`token_version`, refresh token, Valkey trước commit; `disconnectUser` sau); CO-05 purge workspace không đụng bảng HR; CO-06 backfill bỏ user xóa mềm, chưa có Admin ⇒ 403 không 500; CO-07 seed đủ vai trò; **CO-08 nâng EMPLOYEE→ADMIN ngày 15**: departure `ROLE_CHANGED` `last_day` = 15, ngày 15 tính công, 16+ không có trong bảng công, đơn sau 15 dọn, membership ws giữ nguyên; **CO-09 hạ ADMIN→EMPLOYEE ngày 20**: `start_date` = 21, ngày 20 NOT_EMPLOYED, IN ngày 20 ⇒ 422 `NOT_EMPLOYED`; CO-10 IN trước `start_date` ⇒ 422; ADJUSTMENT cho người đã nghỉ trong nhiệm kỳ cũ được, ngoài ⇒ 422; CO-11 `AFTER_LAST_DAY` ở submit/approve/preview.
- **LB-REHIRE** (D H2): nhận lại cùng năm — đơn trước `start_date` không trừ, `adjustmentDays` reset có audit; nhận lại năm khác ⇒ như người mới.
- **Viết lại** (F): SEC-HR-01…29, CC-HR-01…15 sang công ty theo ADR-140.
- **SEC** SEC-HR-30…39, 56…70 (§5).
- **CC**: CC-HR-16 check-in song song cùng user ⇒ 1 IN; CC-HR-17 hai Admin hạ nhau song song ⇒ còn ≥ 1 Admin; CC-HR-18 hoàn tất trong request (`lastDay` quá khứ) ‖ job ‖ chấm Ra 05:59:59 ‖ HR hủy lịch ⇒ đúng **một** departure, một `endMembership`, không 500; CC-HR-19 2 `activate` cùng token ⇒ 1 phiên; 2 `POST hr/employees` cùng email ⇒ 1 tài khoản; CC-HR-26 hoàn tất ‖ submit đơn ×20 ⇒ không đơn PENDING nào sống sau hoàn tất; CC-HR-27 `admin/workspaces/:id/owner` ‖ OWNER cũ được thêm lại ⇒ một OWNER, không 500.
- **CLK** (F §2.3): CLK-HR-05 `lastDay` = **hôm qua**, mốc 05:59:00 ⇒ 05:59:30 còn vào, 06:00:30 ⇒ 401/404 dù job chưa chạy (chờ 60 s, không nhảy ngày); CLK-HR-06 restart API mốc + 7 ngày − 30 s ⇒ link dùng được; quá hạn ⇒ 410; CLK-HR-07 `startDate` −31/−32/ngày mai; CLK-HR-08 `start_date` và `access_until` theo lịch `Europe/Berlin` ngày đổi giờ (`nextVnDateAnchor`); CLK-HR-09 restart mốc + 31 ngày, nhận lại: tháng giữa không tính vắng.
- **E2E** (`workers: 1` cho suite HR): E2E-HR-14 đo `/w` (thẻ gọn + Việc quản lý + Workspace) ở 360/768/1280 không dịch > 8 px; E2E-HR-15 Admin đăng nhập ⇒ `/w` có "Việc quản lý", **không** thẻ chấm công / danh sách workspace; nhân viên thường không thấy menu quản lý; E2E-HR-16 chấm Vào ở `/w` (hoặc nút header) ⇒ HR thấy ở "Hôm nay" (tìm theo tên); tạo workspace mới không cần chấm lại; E2E-HR-17 HR thêm nhân viên ở 360 px ⇒ sao chép link ⇒ context mới mở link, đặt mật khẩu ⇒ `/w` ⇒ chấm công; tên có payload XSS hiện là text ở `/activate` và danh sách; E2E-HR-18 Admin cấp HR cho Mia ở `/admin/access` ⇒ Mia thấy "Nhân sự" không tải lại; E2E-HR-19 OWNER thêm thành viên bằng combobox; HR cho nghỉ OWNER duy nhất với `lastDay` = hôm qua (CLK như CLK-HR-05) ⇒ người đó bị đăng xuất, ws mồ côi ở `/admin/workspaces`, Admin giao OWNER cho thành viên còn lại. axe mọi trang mới.
- Stryker `attendance-domain`, `leave-domain` (tenure đổi kiểu ⇒ chạy lại), `company-domain` mới; chỉ khi TL báo "máy rảnh" (ADR-107).

## 7. Chia việc, quy trình merge, thứ tự

**Nhánh tích hợp** (B HIGH-1): TL tạo `feat/company-level` từ `main`. T-061, T-062, T-063, T-064 (và phần notifications trong T-061) merge vào **nhánh này** sau review từng vé; mỗi vé rebase lên `feat/company-level` mới nhất. Khi đủ 4 vé: TL chạy **một** lượt verify gộp (typecheck, lint, test, integration, security — cổng local theo ADR-107, khi máy rảnh) trên snapshot cố định của nhánh, rồi merge `feat/company-level` → `main` một lần. Vé web T-065 và F T-066 rebase lên nhánh tích hợp cho tới khi nó vào `main`. Lý do: giữa chừng `main` sẽ ở trạng thái nửa ws nửa công ty (route cũ đã xóa, web chưa đổi).

| Vé | Ai | Nội dung | Phụ thuộc | Ước tính |
|---|---|---|---|---|
| T-061 | B | Migration 5 (§3, backfill); module `company`: roles + parity + contracts, `accessUntilOf`, `loadCompanyMember`, `authorizeCompanyWrite`, `assertActiveEmployee`, JOIN `access_until` vào `loadMembership` / refresh / socket gateway / `WorkspaceProjectAccessChecker`; `/auth/me` công ty; xóa register; login/refresh từ chối pending / không thuộc công ty; `admin:bootstrap` (tương tác, `--json` khi test, 24 giờ, nâng nhân viên sẵn có); `admin/access` (nâng/hạ Admin + nhiệm kỳ + thu hồi phiên ADR-105), `admin/workspaces` (owner, archive), `company`; bỏ grants ws; `member-candidates` + thêm theo `userId`; notifications + HrAuditLog công ty; seed mới; threat-model R37–R41 | — **(đầu tiên)** | 3 ngày |
| T-062 | B | ADR-137: `hr/employees` (thêm, nhận lại, response có `version`), token (5 điều khoản), `auth/activation/*`, hạn mức, job hoàn tất mỗi phút (`DELETE … RETURNING`), `endMembership` dùng chung + `IWorkspaceExitPort`, thu hồi phiên ADR-105, last-admin guard; retention D5/D10/D11, `data-retention.md` | T-061 | 2,5 ngày |
| T-063 | A | Attendance sang công ty: cherry-pick `punch-rules.ts` + `lockUserPunch` (62fcc74) bỏ `workspaceId`; `tenure.ts` sang ngày; `ICompanyTenurePort`, `ICompanyAccess` (`assertActiveEmployee` sau khóa); IN ngoài nhiệm kỳ 422; ADJUSTMENT người đã nghỉ; route §4 + `q`; CSV; retention bỏ ws; xóa route cũ + `/me/attendance`; harness attendance; đồng hồ test chấp nhận mốc tiến; adapter `WorkCalendarPort` | T-061 | 2 ngày |
| T-064 | D | Leave sang công ty: route §4 + `q`, khóa `leave:<user>` + `assertActiveEmployee`, số dư `(user, year)`, `AFTER_LAST_DAY`, nhận lại cùng năm (H2), danh bạ số dư (M3), index (M2), adapter `ApprovedLeavePort`, `offboardCleanup` cho T-062 (H1) | T-061 | 1,5 ngày |
| T-065a/b/c | E | (a) header công ty + nút Vào/Ra gọn, `/w` mới (thẻ gọn, Việc quản lý, Workspace), bỏ thẻ ở trang dự án, chuyển `/attendance` `/leave` `/hr` (+ ô tìm), cache `['company']`, `useCompanyPermission`, xử lý 401 `SESSION_REVOKED`; (b) `/hr/employees` (thêm + cảnh báo ngày vắng + hộp link, tạo lại link, nghỉ việc/hủy, dải "làm tới hết ngày", nhận lại), `/activate` (ngoài gate, Sentry scrub), `/admin/*` (access, workspaces: giao OWNER / lưu trữ, company); (c) Thành viên ws: combobox, bỏ công tắc HR; tách ô mật khẩu rồi xóa `/register` | a: T-061 contracts · b: T-062 · c: T-061; từ contracts + mock | 4–4,5 ngày |
| T-066 | F | Harness ADR-140 (bootstrap mỗi file / globalSetup, `createUser`, flush hạn mức, restart API mốc tiến, `reserveDate`, delta thông báo, `workers: 1` HR), bỏ `apiRegister`/`registerViaUi` (11 spec + 3 support), `actors.register` (58 chỗ/12 file), `defaultWorkspaceId` (31 chỗ); viết lại SEC/CC HR; ca mới §6; thời gian suite tăng ~1,3–1,5× (2 request/người) | song song; E2E sau từng vé web | 2,5 ngày |
| — | TL | `payroll.md` v3.2 và `hr-extended.md` v3 theo §8; `DECISIONS.md` ADR-133…140 (ADR-119 bị thay); tạo/merge `feat/company-level`; đóng `feat/T-053-home-checkin`, `feat/T-053a-me-attendance` (sau cherry-pick), `test/T-042-t053-sec`; reset DB local (ADR-138); việc trước deploy: kiểm Zalo giữ fragment (E B6) | sau duyệt | 1 ngày |

Thứ tự: **T-061 → (T-062 ‖ T-063 ‖ T-064) → verify gộp `feat/company-level` → `main`**; T-065a bắt đầu từ contracts T-061; T-065b sau T-062; E2E của F sau từng vé web. Sau đó Mốc 5 (T-054…) rồi Mốc 4 (T-048…) theo `hr-extended.md` §10 đã đánh lại (§8).

**Ước tính:** ≈ 5,5–6 ngày làm việc của cả đội (v1: 4,5–5; + thu hồi phiên/socket/job phút, nhiệm kỳ theo role, dọn đơn hệ thống, web thêm header/nút gọn, harness restart). Đường găng: B (T-061 3 → T-062 2,5) rồi verify gộp; web E 4–4,5 song song. Tùy tải máy (ADR-107).

## 8. Tác động lên Mốc 4 và Mốc 5 (TL sửa sau khi duyệt, trước khi ai code)

**`payroll.md` v3.1 → v3.2:**
1. ADR-124: `CompanyGrant.PAYROLL_MANAGE`; "OWNER ngầm có / chỉ OWNER cấp" ⇒ Admin; luật self tuyệt đối với Kế toán — phiếu của Kế toán do Kế toán khác hoặc Admin sửa.
2. **Admin không có phiếu lương**: bảng lương chỉ gồm người có nhiệm kỳ EMPLOYEE trong kỳ (cắt theo `first_day`/`last_day`, gồm nâng/hạ Admin giữa tháng).
3. Bỏ `ws` mọi bảng: **`payroll_settings` bảng riêng PK hằng `id = 1`** do module payroll sở hữu, tạo ở migration payroll (B MEDIUM-3); `SalaryProfile @@unique(userId, effectiveFrom)`; `PayrollRun @@unique(period)`; `Payslip` bỏ `ws`. Khóa `taskflow:payroll:<period>`; chống lặp nhắc theo `(period, ngày)`.
4. **Một nguồn `hireDate` = `EmployeeProfile`** (A S4): bỏ `SalaryProfile.hireDate`, payroll đọc qua `payroll/application/ports/hire-date.port.ts` (như hr-extended §8).
5. Route `/api/v1/payroll/…`, `/api/v1/payslips/…`; web `/payslips`, `/payroll/…`. Đầu phiếu in **tên công ty**. Gợi ý nhãn "trong công ty".
6. Nhiệm kỳ đọc `ICompanyTenurePort` (ngày). Audit `PAYROLL_*` chỉ Admin đọc. Migration đánh số lại (dưới).

**`hr-extended.md` v2.1 → v3:**
1. **Chuyển sang mốc này** (ADR-137): thêm nhân viên + kích hoạt, nghỉ việc có lịch + job, hủy lịch, nhận lại, danh sách nhân viên, `password_hash` nullable, `account_activation_tokens`, `OFFBOARD_SCHEDULED`, D10/D11, SEC-HR-56…65, CC-HR-26…27 (nội dung mới §6), CLK-HR-15…16 (⇒ CLK-HR-05/06), E2E-HR-26…27 (⇒ E2E-HR-17/19). **T-060 xóa**.
2. **Bỏ:** `PATCH hr/employees/:userId {role}` (MEMBER↔PM).
3. **Ở lại Mốc 5, phạm vi công ty:** ADR-128 `EmployeeProfile` PK `user_id` (SEC-HR-44 bỏ); form "Thêm nhân viên" thêm 4 trường + **giữ `hireDate` cũ** khi nhận lại (T-054); `profile:self` chỉ EMPLOYEE. ADR-129 đơn bổ sung bỏ `workspaceId`, "người gửi còn là nhân viên" = `assertActiveEmployee`. ADR-130 xuất cả công ty. ADR-131 `LeavePolicy` PK `year`, khóa `taskflow:leave-policy` (bậc 1 bảng khóa ADR-136).
4. **Phép năm khi nhận lại / phép chuyển** (D H3, TL chốt): `carried` sang năm Y chỉ khi người đó làm **liên tục** qua 31/12(Y−1) → 01/01(Y). Năm đầu **đủ base** (người dùng đã chốt) tính từ `max(hireDate, start_date hiện tại)`; nhận lại giữa năm Y: nhiệm kỳ trước **không** thuộc năm Y ⇒ đủ base năm Y như người mới; nhiệm kỳ trước **cùng** năm Y ⇒ **không cấp lại**, tiếp tục số dư năm Y theo ADR-136 (đơn trước `start_date` không tính, `adjustmentDays` reset). Test LP-03 + LB-REHIRE.
5. Mọi "OWNER" ⇒ "Admin"; Admin không có hồ sơ/phép/đơn bổ sung; route bỏ `/workspaces/:wsId/`; web `/my-profile`; tab Nhân viên = `/hr/employees` của mốc này.
6. **Đánh lại migration:** 5 `company_level` (T-061) · 6 hồ sơ (T-054) · 7 payroll + `payroll_settings` (T-048) · 8 đơn bổ sung (T-055) · 9 chính sách phép (T-057). Timestamp đặt lúc merge.

## 9. Đã chốt (người dùng 17/10)

1. **Admin không chấm công, không xin nghỉ, không phiếu lương** — Admin không phải nhân viên; vẫn quản trị + nhân sự + lương (TL: ngầm có quyền) — ADR-134.
2. **Workspace mồ côi:** Admin giao OWNER cho một thành viên còn lại (tự nhận chỉ khi vốn là thành viên — TL v2.1), không thấy dữ liệu dự án ws mình không là thành viên; 0 thành viên ⇒ lưu trữ — ADR-134, R39.
3. **DB local:** xóa hết + seed lại; TL chạy sau khi mốc merge vào `main` — ADR-138.
4. **Tên công ty** nhập lúc bootstrap, Admin sửa sau; nhãn UI giữ "Workspace" (không đổi thành "Nhóm dự án") — ADR-137, ADR-139.

Không có câu hỏi mới cho người dùng. Việc kỹ thuật trước deploy: kiểm Zalo giữ fragment (ADR-137). R27 Q2/Q4/Q5 vẫn mở như trước.
