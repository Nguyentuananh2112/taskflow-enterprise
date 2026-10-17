# Mốc 3.5 — Cấp công ty (thiết kế, CHỜ người dùng duyệt)

> Trạng thái: **đề xuất v1** (Tech Lead, 2026-10-17). ADR-133…140 chỉ ghi vào `DECISIONS.md` sau khi người dùng duyệt; rủi ro R37–R39 vào `threat-model.md` §6 (B). Vé T-061…T-066. Chưa ai code trước khi duyệt. **Làm TRƯỚC Mốc 4 và Mốc 5.**
> Căn cứ: `attendance-leave.md` (ADR-119…123, §9), `data-retention.md` (R27), `payroll.md` v3.1 (`tl/m4-payroll-design`, ADR-124…127), `hr-extended.md` v2.1 (`tl/m5-hr-design`, ADR-128…132), `schema.prisma`, `workspace/domain/roles.ts`, module `auth`/`attendance`/`leave`/`notifications`, web `app/(app)/w/…`, nhánh T-053a @62fcc74. Góp ý đội: A (domain), E (web), F (harness) — ghi nguồn tại chỗ. Dữ liệu ví dụ là bịa.

**Thay ADR-119 (grants theo workspace) và phần "Một workspace = một công ty" của `attendance-leave.md`.** Luật nghiệp vụ Mốc 3 (tính công, đơn nghỉ, số dư, khóa, luật self, thông báo bền, R27) **giữ nguyên**, chỉ đổi phạm vi từ workspace sang công ty.

## 0. Quyết định

| Điểm | Ai chốt | Chốt |
|---|---|---|
| TaskFlow phục vụ **một** công ty (công cụ nội bộ), không đa tenant | Người dùng 17/10 | ADR-133 |
| Admin, HR là vai trò **cấp công ty**, thấy ngay ở trang chính sau đăng nhập | Người dùng 17/10 | ADR-134, ADR-139 |
| Workspace **chỉ** để quản lý dự án (dự án, task, bình luận, OWNER/PM/MEMBER/VIEWER) | Người dùng 17/10 | ADR-134 |
| Chấm công, nghỉ phép, lịch, ngày lễ, lương, hồ sơ, vào làm/nghỉ việc thuộc **công ty** | Người dùng 17/10 | ADR-136 |
| Tắt tự đăng ký; chỉ HR/Admin tạo tài khoản (link kích hoạt) | Người dùng 17/10 | ADR-137 |
| Bỏ T-053 ("chấm một lần cho mọi workspace"); chấm công là một thao tác cấp công ty ở trang chính | Người dùng 17/10 | ADR-136, ADR-139 |
| Chưa production ⇒ đổi schema tự do, không chuyển dữ liệu HR | Người dùng 17/10 | ADR-138 |
| Bảng `companies` một dòng + `company_members`; **không** cột `companyId` trên bảng nghiệp vụ | TL | ADR-133 |
| Admin **không** ngầm có quyền xem dự án; chỉ thấy danh sách workspace + gán OWNER cho workspace mồ côi | TL | ADR-134 |
| Mọi nhân viên đang làm tạo được workspace; thêm thành viên workspace = chọn từ nhân viên công ty | TL | ADR-134 |
| Nhiệm kỳ (ngày vào/nghỉ) lấy từ vòng đời công ty, **tách hẳn** membership dự án; `hireDate` của lương/phép cũng cấp công ty | TL (A) | ADR-133, ADR-136 |
| **Một** bộ lịch + ngày lễ + múi giờ cho cả công ty (không lịch theo nhóm/chi nhánh ở v1) | TL (A) | ADR-136 |
| Admin đầu tiên tạo bằng lệnh CLI, không bao giờ qua web | TL | ADR-137 |
| Vào làm / kích hoạt / nghỉ việc / nhận lại (phần lõi ADR-132) chuyển về mốc này làm nền | TL | ADR-137, §8 |
| HR **không** còn đổi vai trò dự án (MEMBER↔PM của ADR-132 bỏ) — vai trò dự án do OWNER/PM workspace | TL | ADR-134 |
| Link kích hoạt hạn **7 ngày** (như ADR-132), một lần | TL (F) | ADR-137 |

## 1. Phạm vi

**Có:** công ty một dòng (tên); vai trò Admin/Nhân viên + quyền cấp thêm HR, Kế toán; quyền cấp công ty tách khỏi quyền workspace; chuyển toàn bộ chấm công/nghỉ phép/lịch/ngày lễ/HrAuditLog/thông báo HR sang công ty; bỏ route `/workspaces/:wsId/attendance|leave…`; tắt `/auth/register`; lệnh `admin:bootstrap`; HR/Admin thêm nhân viên (link kích hoạt), cho nghỉ việc có lịch, nhận lại, danh sách nhân viên; Admin: cấp/thu quyền, danh sách workspace, gán OWNER cho workspace mồ côi; trang chính mới; seed mới; harness test mới.

**Không:** nhiều công ty / chi nhánh / lịch theo nhóm; khách ngoài công ty vào dự án (mọi tài khoản đều là nhân viên — VIEWER vẫn là vai trò dự án cho nhân viên); Admin xem nội dung dự án; email (HR sao chép link); hồ sơ 4 trường, đơn bổ sung giờ, Excel, chính sách phép (vẫn Mốc 5); lương (Mốc 4).

## 2. ADR đề xuất

**ADR-133 — Một công ty: bảng `companies` một dòng + `company_members`.**
- `companies(id SMALLINT PK CHECK (id = 1), name VarChar(100), version, updated_at)` — một dòng, tạo bởi `admin:bootstrap` (seed ở dev). Múi giờ **không** ở đây: vẫn nằm trong phiên bản lịch (ADR-120).
- `company_members` — **dòng tồn tại ⇔ đang thuộc công ty** (kể cả chờ kích hoạt, đang có lịch nghỉ): `user_id PK → users Restrict`, `role CompanyRole {ADMIN, EMPLOYEE}`, `grants CompanyGrant[] {HR_MANAGE, PAYROLL_MANAGE}`, `joined_at` (đầu nhiệm kỳ hiện tại), `offboard_last_day?`, `offboard_access_until?`, `offboard_scheduled_by_id?`, `version`, timestamps.
- Nghỉ việc = xóa dòng + ghi `company_member_departures(id, user_id, role, joined_at, left_at, reason {OFFBOARDED, REMOVED})` **cùng transaction** — đúng mẫu T-037b (`workspace_member_departures`), nên domain `tenure.ts` dùng lại nguyên (A).
- Trạng thái hiển thị **suy ra**, không lưu: `PENDING_ACTIVATION` (`users.password_hash IS NULL`), `OFFBOARDING` (`offboard_last_day` khác null), `ACTIVE`, `LEFT` (không có dòng, có departure). Bác cột `status`: hai nguồn sự thật với `password_hash`/departure.
- **Không `companyId`** trên `attendance_events`, `leave_*`, `work_schedules`, `holidays`, `notifications`, `hr_audit_logs`, payroll: một công ty ⇒ cột hằng chỉ làm rối mọi unique/index/khóa. Nhiều công ty sau này = **triển khai thêm một instance + DB riêng** (rẻ nhất, cách ly thật); nếu một ngày cần chung DB thì một migration thêm cột (đã liệt kê bảng ở §3). Mọi repository công ty đi qua một chỗ (`company` scope) để việc đó khoanh vùng được.
- *Bác:* (b) cột `role/grants/status` trên `users` — trộn tài khoản (auth) với tư cách nhân viên (HR), departure/nhiệm kỳ không có chỗ, auth phải biết nghiệp vụ HR; giữ `workspaceId` làm "công ty" — chính là lỗi người dùng chỉ ra.

**ADR-134 — Vai trò cấp công ty độc lập với vai trò workspace.**

| Vai trò | Là gì | Quyền công ty |
|---|---|---|
| **Admin** (`role = ADMIN`) | Chủ công ty; ≥ 1 Admin luôn tồn tại | tất cả: `company:admin`, `company:grant`, `hr:manage`, `payroll:manage` + quyền nhân viên |
| **HR** (grant `HR_MANAGE`) | Nhân viên được giao nhân sự | `hr:manage` |
| **Kế toán** (grant `PAYROLL_MANAGE`) | Nhân viên được giao lương | `payroll:manage` (Mốc 4) |
| **Nhân viên** (`role = EMPLOYEE`) | Mọi người đang làm | `attendance:self`, `leave:self`, `profile:self` (Mốc 5), `workspace:create` |

- **Không ánh xạ** vai trò công ty ↔ vai trò workspace (trả lời F#3): Admin **không** ngầm có quyền đọc/sửa dự án (dữ liệu dự án riêng tư theo nhóm). Admin thấy `/admin/workspaces`: tên, OWNER, số thành viên, đã xóa mềm chưa, cờ **mồ côi** (không còn OWNER — xảy ra khi OWNER duy nhất nghỉ việc). Admin gán OWNER mới cho workspace mồ côi (`POST /admin/workspaces/:id/owner {userId}` — một nhân viên đang làm, có thể là chính Admin; audit `WORKSPACE_OWNER_ASSIGNED`, phát `member:role-changed` như cũ). Workspace còn OWNER ⇒ 409 `workspace_has_owner`. Không có lệnh xóa/lưu trữ workspace của Admin ở v1.
- **Tạo workspace:** mọi nhân viên đang làm (người tạo thành OWNER — như hiện nay). Người dùng nói workspace để quản lý dự án, không có lý do giới hạn.
- **Thành viên workspace phải là nhân viên công ty:** `POST /workspaces/:wsId/members` đổi `{email, role}` ⇒ `{userId, role}`; người được chọn từ `GET /workspaces/:wsId/member-candidates?q=` (quyền `member:add`; nhân viên đang làm hoặc chờ kích hoạt, chưa ở ws; `q` 2..100 ký tự, escape LIKE, limit 20; chỉ trả `id, fullName, email`). Không phải nhân viên / đang có lịch nghỉ / đã nghỉ ⇒ 422 `NOT_ACTIVE_EMPLOYEE`. Không có danh bạ công ty chung (giữ "Không" của Mốc 5).
- **Nghỉ việc công ty ⇒ rời mọi workspace** (ADR-137) bằng lõi `endMembership` tách từ `RemoveMemberUseCase` (bỏ gán task, `revokeWorkspaceAccess`); OWNER duy nhất rời ⇒ ws mồ côi (không chặn nghỉ việc vì dữ liệu dự án; Admin được báo).
- Bảng `workspace_members` bỏ `grants`; ma trận workspace bỏ `attendance:self`, `leave:self`, `hr:manage`, `hr:grant`.
- Admin: thêm/hạ Admin chỉ Admin làm; hạ/cho nghỉ Admin cuối cùng ⇒ 409 `last_admin` (khóa `taskflow:company:admins`, mẫu `owner-guard`). Grant chỉ cấp cho EMPLOYEE (Admin đã có ngầm ⇒ 422, như B-M2); nâng lên ADMIN ⇒ xóa grants cùng transaction.

**ADR-135 — Ma trận quyền công ty riêng; middleware công ty.**
- Module mới `company`: `company/domain/roles.ts` (TS thuần) — `COMPANY_PERMISSIONS`, `COMPANY_ROLE_PERMISSIONS`, `COMPANY_GRANT_PERMISSIONS`, `effectiveCompanyPermissions(role, grants)`; bản dữ liệu thuần trong `packages/contracts`, **test parity** như ADR-080. Parity chứng minh: `HR_MANAGE` chỉ `{hr:manage}`, `PAYROLL_MANAGE` chỉ `{payroll:manage}`; không grant nào chứa `company:*`; tập quyền công ty ∩ tập quyền workspace = ∅; thêm grant phải qua ADR.
- `hr:grant` (ADR-119) ⇒ **`company:grant`** (cấp cả HR lẫn Kế toán, chỉ Admin).
- Middleware `loadCompanyMember` cho router `/api/v1/{attendance,leave,hr,admin,company,payroll,payslips}` và `POST /workspaces`: một truy vấn theo `userId` (không cache), coi `offboard_access_until ≤ now` là không còn thuộc công ty. Thứ tự lỗi: chưa đăng nhập 401 → **không thuộc công ty ⇒ 401 `SESSION_REVOKED`** (phiên của người đã nghỉ bị thu hồi — ADR-137; không có trạng thái "đăng nhập mà không thuộc công ty") → thiếu quyền 403 (`permit` chạy TRƯỚC validate ⇒ body sai vẫn 403) → 400 → `userId`/tài nguyên không có ⇒ 404 → 422/409.
- `loadMembership` của workspace JOIN `company_members` trong **cùng** câu truy vấn và áp cùng điều kiện `access_until` ⇒ đúng giờ nghỉ việc là mất mọi ws, không chờ job (thay "kiểm khi đọc" trên `workspace_members` của ADR-132).
- Lệnh ghi `hr:manage`/`payroll:manage`/`company:*` qua `authorizeCompanyWrite({actorId, targetUserId?, reason?})`: khóa dòng `company_members` của actor FOR SHARE, đọc lại role + grants (thu quyền có hiệu lực ngay — B-H3). Luật self (B-H1) giữ nguyên, **"trừ OWNER" đổi thành "trừ Admin"** (bắt buộc lý do + audit); R26 chuyển sang Admin.
- `/auth/me` thêm `company: {name, role, grants, permissions, status}`; event `company:access-changed {role, grants}` tới `user:{id}` khi đổi role/grant (thay `member:grants-changed`).

**ADR-136 — Chấm công, nghỉ phép, lịch, ngày lễ, HrAuditLog, thông báo HR thuộc công ty.**
- Bỏ `workspace_id` khỏi mọi bảng Mốc 3 (§3). Purge workspace **không còn** xóa dữ liệu HR (đúng hơn: xóa một dự án không được làm mất bảng công).
- **Nhân viên** = có dòng `company_members` hiệu lực (A#5), không phụ thuộc role ws: VIEWER của mọi dự án vẫn chấm công. Admin cũng chấm công/xin nghỉ (mặc định — câu hỏi Q1).
- Nhiệm kỳ: port `ICompanyTenurePort.tenuresOf({userIds?, from, to})` (attendance sở hữu, adapter ở `company`) đọc `company_members.joined_at` + `company_member_departures` — cùng hợp đồng với `IMembershipTenurePort` hiện tại trừ `workspaceId`. `IHrAccess` ⇒ `ICompanyAccess` (`authorizeWrite`, `isEmployee`).
- **Một** bộ lịch có phiên bản (`work_schedules.effective_from` unique) + ngày lễ (`holidays.date` PK) + múi giờ trong phiên bản cho cả công ty (A#4).
- **Tái dùng gần nguyên** (A#3): `summarizeDay`, `work-date`, `tenure`, `summarizeUsers`, totals T-046, gộp AM+PM T-052, retention T-047, luật đơn nghỉ/số dư/máy trạng thái §9. `punch-rules.ts` + `lockUserPunch` **cherry-pick từ `feat/T-053a-me-attendance` @62fcc74** rồi bỏ `workspaceId`; phần "chấm gộp mọi ws" bỏ. Chỉ đổi chữ ký use case / port / route.
- Khóa: lượt chấm `taskflow:attendance:punch:<user>` (đã theo user — T-053a); đơn nghỉ `taskflow:leave:<user>` (bỏ ws); payroll `taskflow:payroll:<period>` (A#7).
- Unique một phần: `(user_id, work_date) WHERE kind='IN' AND source='WEB' AND voided_at IS NULL`; `(user_id, source, idempotency_key) WHERE idempotency_key IS NOT NULL`.
- Thông báo: bỏ `workspace_id`; audience HR = nhân viên đang có `hr:manage` hiện tại (lọc lúc đọc như B-H3); DTO bỏ `workspaceName`. `HR_GRANTED/HR_REVOKED` ⇒ `ACCESS_CHANGED` (refId = userId). Thông báo dự án sau này (nếu có) thêm `workspace_id` nullable — không làm bây giờ.
- HrAuditLog bỏ `workspace_id`; **chỉ Admin đọc** (thay "chỉ OWNER", B-L1). Sửa ngày lễ / lịch trong quá khứ: "chỉ OWNER" ⇒ chỉ Admin (ADR-121).
- Route cũ `/api/v1/workspaces/:wsId/attendance/*`, `…/leave-requests*`, `…/leave-balances*`, `…/members/:userId/grants`, `…/hr-audit-logs` **bị xóa** (404 tự nhiên). Chưa production ⇒ không giai đoạn song song.

**ADR-137 — Tài khoản: tắt tự đăng ký, Admin bootstrap, HR/Admin thêm nhân viên bằng link kích hoạt, nghỉ việc cấp công ty.**
- **Tắt đăng ký:** xóa route `POST /auth/register`, use case, rule hạn mức `register`, trang web `/register` và mọi link tới nó. `POST /auth/register` ⇒ **404** chung của router (không lộ email tồn tại); có ca SEC giữ hồi quy. Bác cờ env "mặc định tắt": một cấu hình sai là mở cửa cho người ngoài vào công ty.
- **Admin đầu tiên:** `pnpm --filter @taskflow/api admin:bootstrap` (production: `node dist/cli/admin-bootstrap.js`, entry tsdown riêng) đọc `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `COMPANY_NAME`. Trong một transaction dưới `pg_advisory_xact_lock(taskflow:company:admins)`: tạo dòng `companies` nếu chưa có + user **chờ kích hoạt** + `company_members(ADMIN)` + token kích hoạt; in link ra stdout (`--json` cho máy đọc). **Không nhận mật khẩu qua env** (lọt vào lịch sử shell / biến môi trường container). Thiếu env ⇒ thoát lỗi, **không bao giờ** tạo admin mặc định. Đã có Admin ⇒ thoát mã 1 + báo rõ "Đã có Admin — không làm gì", không tạo Admin thứ hai, không đổi mật khẩu ai. Ngoại lệ duy nhất `--reissue-link`: chỉ khi **mọi** Admin còn chờ kích hoạt (link hết hạn trước khi dùng) ⇒ cấp lại link cho Admin đó. Không bao giờ có endpoint web bootstrap. Harness E2E/SEC gọi **đúng lệnh này** (F, trả lời F#1).
- **Thêm nhân viên** (`POST /hr/employees`, `hr:manage`; một transaction): `{email, fullName, startDate?}` ⇒ email mới: user `password_hash NULL` + `company_members(EMPLOYEE, joined_at = 00:00 startDate theo lịch)` + token; email của người đã nghỉ ⇒ **nhận lại** (nhiệm kỳ mới, departure cũ giữ, không token nếu đã có mật khẩu); đang thuộc công ty ⇒ 409 `already_employee`; tài khoản đã xóa ⇒ 422 `EMAIL_UNAVAILABLE`. `startDate` mặc định hôm nay, lùi ≤ 31 ngày, không tương lai. HR không tạo Admin, không cấp grant (body strict ⇒ 400). Hạn mức 30 lần/giờ/actor (thay limiter đăng ký).
- **Token kích hoạt** (điều khoản bắt buộc — F): (1) 32 byte ngẫu nhiên base64url, DB chỉ lưu SHA-256 (`account_activation_tokens`), tra theo hash; token **chỉ xuất hiện MỘT lần** trong response của "thêm" / "tạo lại link" cho chính người tạo (`Cache-Control: no-store`), không có route GET đọc lại; (2) một lần, hạn **7 ngày**; "tạo lại link" thu hồi token cũ **ngay**; mỗi user ≤ 1 token sống (partial unique); (3) không bao giờ trong log (pino redact), Sentry, audit (chỉ `ACTIVATION_LINK_ISSUED`), thông báo, URL API — link cho nhân viên `<WEB_ORIGIN>/activate#t=<token>` (fragment không tới server/Referer), token đi trong **body** POST; (4) **mở trang không tiêu token**: GET `/activate` và việc trang tải không đổi trạng thái, không gọi API tiêu token (bot xem trước link của Zalo/Messenger/Slack không làm hỏng link); `POST /auth/activation/inspect {token}` chỉ đọc (trả `{fullName, companyName}`); token **chỉ** bị tiêu ở `POST /auth/activate {token, password}`: `PasswordPolicy` (kèm email), một transaction đặt `password_hash` + `used_at` (`UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now()` đếm 1) ⇒ cấp phiên mới như đăng nhập; mật khẩu yếu ⇒ 422, token **vẫn sống**; (5) token sai/đoán ⇒ cùng một 400 `ACTIVATION_INVALID` + hạn mức theo IP như login; đã dùng / hết hạn / đã thu hồi ⇒ 410 `ACTIVATION_GONE` (TL chốt theo F; token 256 bit nên 410 không giúp dò); web hiện cùng câu "Link không còn hiệu lực — xin bộ phận nhân sự link mới"; trang `Referrer-Policy: no-referrer`, `history.replaceState` xóa fragment.
- **Không mở lỗ:** login với `password_hash IS NULL` ⇒ như không có user (hash giả, cùng lỗi, cùng thời gian — LOG-04); login/refresh của người **không còn dòng `company_members`** ⇒ như sai thông tin; không có luồng quên mật khẩu (thêm sau phải loại user chờ kích hoạt). `passwordHash` Prisma thành nullable ⇒ trình biên dịch chỉ ra mọi chỗ đọc.
- **Cho nghỉ việc có lịch** (`PUT /hr/employees/:userId/offboarding {lastDay, reason?}`, `DELETE` để hủy): `lastDay ∈ [hôm nay − 31, hôm nay + 90]`; `access_until` = 06:00 ngày sau `lastDay` theo lịch (giờ chốt ngày công A#7). HR không tác động chính mình, Admin, người giữ grant ⇒ 403 (chỉ Admin làm). Response cảnh báo: số đơn chờ, danh sách ws mà người đó là **OWNER duy nhất** (sẽ mồ côi). Thông báo `OFFBOARD_SCHEDULED` cho nhân viên + Admin.
- **Hoàn tất** (job 10 phút, advisory lock, theo lô, idempotent — mẫu T-033; hoặc ngay trong request nếu `access_until ≤ now`), một transaction: ghi departure `OFFBOARDED` (`left_at` = 00:00 ngày sau `lastDay`), xóa `company_members`, `endMembership` ở **mọi** workspace (port `IWorkspaceExitPort` do company sở hữu, adapter ở workspace), dọn đơn nghỉ qua port (PENDING sau `lastDay` ⇒ CANCELLED; APPROVED bắt đầu sau ⇒ REVOKED; vắt qua giữ), thu hồi token kích hoạt sống, **thu hồi mọi phiên** (tăng `token_version` + revoke refresh token, lý do mới `OFFBOARDED`). Khóa theo thứ tự cố định: `taskflow:company:admins` (shared) → `taskflow:leave:<user>` → `taskflow:attendance:punch:<user>` → owner-guard từng ws theo id tăng dần.
- **Không xóa vĩnh viễn trên UI** (giữ ADR-132): "xóa" = nghỉ việc; R27 tự xóa/ẩn danh khi hết hạn.

**ADR-138 — Migration một lần, không chuyển dữ liệu HR; seed viết lại.**
- Migration 5 `company_level` (thay số 5 của Mốc 5 — §8): tạo enum/bảng công ty, `users.password_hash` DROP NOT NULL, **DROP + CREATE** lại `work_schedules`, `holidays`, `attendance_events`, `leave_requests`, `leave_balances`, `notifications`, `hr_audit_logs` không có `workspace_id` (không giữ dữ liệu — A#2), DROP `workspace_member_departures`, `workspace_members.grants`, enum `MemberGrant`. CHECK/partial unique bằng SQL tay như migration 3/4. `grant-app.sql` đã cấp DML cho mọi bảng — không cần script quyền mới.
- **Backfill tối thiểu** trong cùng migration: `INSERT INTO company_members (user_id, role, joined_at) SELECT id, 'EMPLOYEE', created_at FROM users WHERE deleted_at IS NULL` — để DB có sẵn user (dev, CI) vẫn đăng nhập được sau migrate; không có Admin ⇒ chạy `admin:bootstrap`. Không tạo dòng `companies` (bootstrap/seed tạo).
- **Seed mới** (`prisma/seed.ts`, vẫn chặn production, mật khẩu chung dev): công ty "Công ty Mẫu" · Olivia **Admin** · Pam **HR** · Max **Kế toán** · Mia, Vic, Otto nhân viên · Nina **chờ kích hoạt** (seed in link) · Quinn **đã nghỉ** (có departure, có công tháng trước) · 2 workspace mẫu như hiện nay (Olivia không ở workspace thứ hai — minh họa Admin không thấy dự án) · lịch mặc định, 2 ngày lễ bịa, vài lượt chấm + đơn nghỉ.
- **DB local của người dùng** (cổng 5435): hai cách, **cần người dùng đồng ý trước khi chạy** (Q3):
  - (khuyến nghị) `prisma migrate reset` + seed: mất **toàn bộ** dữ liệu local — tài khoản tự đăng ký, workspace, dự án, task, lượt chấm, đơn nghỉ, số dư, lịch, ngày lễ, thông báo, audit — thay bằng dữ liệu mẫu.
  - chỉ `migrate deploy` + `admin:bootstrap`: giữ tài khoản, workspace, dự án, task; **mất** mọi dữ liệu chấm công/nghỉ phép/lịch/ngày lễ/thông báo/HrAuditLog và quyền HR đã cấp.
  - DB test (5434) do harness reset — không cần hỏi.

**ADR-139 — Trang chính `/w` theo vai trò; trang công ty không có `wsId`.**
- Route công ty ở gốc (E): `/attendance`, `/leave`, `/hr` (+ `/hr/employees`), `/admin` (`/admin/access`, `/admin/workspaces`, `/admin/company`), `/payslips`, `/payroll` (Mốc 4), `/activate` (công khai, ngoài khung app). `/w/[wsId]` chỉ còn dự án/board/settings. Xóa `/w/[wsId]/{attendance,leave,hr}`, `/register`.
- `/w` sau đăng nhập, 360 px trước, từ trên xuống: (1) header: menu theo quyền — "Nhân sự" (`hr:manage`), "Bảng lương" (`payroll:manage`), "Quản trị" (`company:admin`) + chuông; (2) **thẻ chấm công lớn** — một nút Vào/Ra, giờ server, trạng thái hôm nay (tái dùng card-frame, `CheckInPrompt` — chấm một lần là xong, không theo ws); (3) lối tắt: "Bảng công của tôi", "Xin nghỉ", "Phiếu lương" (ẩn tới Mốc 4); (4) **"Dự án của bạn"**: danh sách workspace + "Tạo workspace". Không dịch bố cục > 8 px (cách đo E2E-HR-14).
- Trang Thành viên workspace: bỏ công tắc "Quản lý nhân sự"; ô "Thêm thành viên" là ô tìm nhân viên công ty (combobox, `member-candidates`), không gõ email tự do. Cấp quyền HR/Kế toán/Admin ở `/admin/access`.
- Cache (E): gốc key `['company', …]` thay `['ws', wsId, …]` cho dữ liệu HR; xóa khi đăng xuất và khi nhận `company:access-changed` mất quyền. Hook `useCompanyPermission(p)` đọc từ `/auth/me`. ~25 component chỉ đổi URL; lịch/bảng/thẻ tái dùng nguyên.

**ADR-140 — Harness test: tạo người qua đường production, không route test-only** (F; giữ nguyên tắc T-026: seed qua API công khai, không chèn DB).
- `globalSetup` chạy `admin:bootstrap --json` trên DB test ⇒ lấy link ⇒ `POST /auth/activate` ⇒ phiên Admin. User khác: `Actors.createUser(label, {grants?, admin?, workspace?})` = Admin gọi `POST /hr/employees` (token trong response) ⇒ `activate` ⇒ (tùy chọn) Admin `PUT /admin/access/:userId` ⇒ OWNER thêm vào ws qua `{userId}`. `newWorkspace(owner)` tạo tường minh; `defaultWorkspaceId` bỏ dần. Alias `register` tạm trong harness tới khi chuyển xong rồi xóa.
- Trả lời F#4: một công ty / một DB ⇒ cách ly tenant chỉ còn ở **workspace dự án** (ADR-020 giữ nguyên); ca cách ly HR (vd SEC-HR-01 Otto ở W2) viết lại thành **phân quyền trong cùng công ty** (nhân viên thường đọc công người khác ⇒ 403/404 theo thứ tự §ADR-135). `joinedAt` công ty theo giờ nghiệp vụ (test clock `TEST_CLOCK_ANCHOR`).

## 3. Dữ liệu — migration 5 `company_level`

```
enum CompanyRole        { ADMIN EMPLOYEE }
enum CompanyGrant       { HR_MANAGE PAYROLL_MANAGE }        -- PAYROLL_MANAGE dùng từ Mốc 4; khai sẵn để parity đủ
enum DepartureReason    { OFFBOARDED REMOVED }              -- thay MemberDepartureReason
enum RefreshTokenRevokeReason + OFFBOARDED
enum NotificationType   − HR_GRANTED HR_REVOKED  + ACCESS_CHANGED OFFBOARD_SCHEDULED
DROP enum MemberGrant

companies               (id SMALLINT PK CHECK id = 1, name VarChar(100) CHECK btrim<>'' , version, updated_at)
company_members         (user_id PK → users Restrict, role, grants CompanyGrant[] DEFAULT '{}',
                         joined_at Timestamptz(3), offboard_last_day Date?, offboard_access_until Timestamptz(3)?,
                         offboard_scheduled_by_id? → users Restrict, version, created_at, updated_at)
                         CHECK role = 'EMPLOYEE' OR grants = '{}'
                         CHECK 3 cột offboard cùng NULL / cùng khác NULL
                         INDEX (offboard_access_until) WHERE offboard_access_until IS NOT NULL   -- job hoàn tất
                         INDEX (role)                                                            -- last-admin guard
company_member_departures (id, user_id → users Restrict, role, joined_at, left_at, reason)
                         INDEX (user_id), INDEX (left_at)
account_activation_tokens (id, user_id → users Cascade, token_hash Char(64) UNIQUE, expires_at, used_at?, revoked_at?,
                         created_by_id? → users Restrict  -- NULL = do `admin:bootstrap` cấp (không có người tạo)
                         , created_at)
                         UNIQUE (user_id) WHERE used_at IS NULL AND revoked_at IS NULL; INDEX (expires_at)
users                   password_hash DROP NOT NULL (NULL = chờ kích hoạt)
workspace_members       − grants
DROP workspace_member_departures

-- Tạo lại không workspace_id (cột/khóa còn lại như schema hiện tại):
work_schedules          UNIQUE (effective_from)
holidays                PK (date)
attendance_events       INDEX (work_date), (user_id, work_date); 2 partial unique như ADR-136
leave_requests          INDEX (status), (user_id, start_date)
leave_balances          PK (user_id, year)
notifications           INDEX (recipient_id, read_at, created_at)
hr_audit_logs           INDEX (created_at DESC, id DESC); action + COMPANY_ROLE_SET GRANT_SET EMPLOYEE_HIRED
                          EMPLOYEE_OFFBOARD_SCHEDULED EMPLOYEE_OFFBOARD_CANCELLED EMPLOYEE_OFFBOARD_COMPLETED
                          ACTIVATION_LINK_ISSUED WORKSPACE_OWNER_ASSIGNED   (GRANT/REVOKE cũ bỏ)
```
FK user giữ `Restrict` như Mốc 3 (lịch sử không mất khi nghỉ việc). Bảng HR không còn FK tới `workspaces`. Nếu sau này cần nhiều công ty chung DB: thêm `company_id` vào đúng các bảng trong khối "Tạo lại" + payroll + `company_members`.

## 4. API (`/api/v1/…`, contracts Zod `.strict()` + OpenAPI)

Luật, hạn mức, header (`Idempotency-Key`, `no-store`, CSV) của từng route **giữ như `attendance-leave.md` §5, §9**, chỉ đổi đường dẫn và quyền.

| Route mới | Quyền | Thay cho |
|---|---|---|
| `GET attendance/me/today` · `POST attendance/check-in` · `POST attendance/check-out` · `GET attendance/me?month` · `GET attendance/me/events?date` | `attendance:self` | `workspaces/:wsId/attendance/…`, `POST /me/attendance` (T-053a) |
| `GET attendance/today` · `GET attendance?month` · `GET attendance/export.csv` · `GET/POST attendance/events…` | `hr:manage` | như trên |
| `GET/POST attendance/schedules` · `GET/PUT/DELETE attendance/holidays/:date` | đọc: nhân viên · ghi: `hr:manage` (quá khứ: Admin) | như trên |
| `POST leave/requests` · `GET leave/requests?mine=1` · `GET leave/requests/preview` · `POST leave/requests/:id/cancel` · `GET leave/balances/me` | `leave:self` | `…/leave-requests`, `…/leave-balances/me` |
| `GET leave/requests?status` · `POST leave/requests/:id/{approve,reject,revoke}` · `GET leave/balances` · `PATCH leave/balances/:userId/:year` | `hr:manage` | như trên |
| `GET hr/employees?status=active\|pending\|offboarding\|left&q&cursor` · `POST hr/employees` · `POST hr/employees/:userId/activation-link` · `PUT/DELETE hr/employees/:userId/offboarding` | `hr:manage` | ADR-132 (đã bỏ `PATCH` đổi vai trò dự án) |
| `GET hr/audit-logs?cursor` | `company:admin` | `…/hr-audit-logs` |
| `GET admin/access` · `PUT admin/access/:userId {role, grants, expectedVersion}` | `company:admin` / `company:grant` | `PUT …/members/:userId/grants` |
| `GET admin/workspaces` · `POST admin/workspaces/:id/owner {userId}` | `company:admin` | mới |
| `GET company` · `PATCH company {name, expectedVersion}` | nhân viên · `company:admin` | mới |
| `GET workspaces/:wsId/member-candidates?q` · `POST workspaces/:wsId/members {userId, role}` | `member:add` | `{email, role}` |
| `POST auth/activation/inspect` · `POST auth/activate` | công khai (origin cho phép, hạn mức IP) | mới |
| `POST auth/register` | — | **xóa** ⇒ 404 |
| `GET me/notifications…` | đăng nhập | bỏ lọc "ws còn là thành viên" |

`userId` trong route HR: không phải nhân viên hiện tại và chưa từng có nhiệm kỳ ⇒ 404 `user`; người đã nghỉ vẫn xem/xuất được công (R30).

## 5. Bảo mật (B) — ca SEC cho F

Dải lấy lại của T-053 trước: **SEC-HR-30…35**, rồi SEC-HR-36…39 (còn trống trước dải Mốc 5). Các ca kích hoạt/nghỉ việc của Mốc 5 **SEC-HR-56…65** chuyển sang mốc này, giữ số, sửa nội dung theo §8.

| Mã | Ca | Mong đợi |
|---|---|---|
| SEC-HR-30 | Leo quyền: nhân viên / HR / Kế toán `PUT admin/access/:self` hoặc người khác (đặt ADMIN, thêm grant); body có `role` khi `POST hr/employees` | 403; 400 strict |
| SEC-HR-31 | HR cấp/thu HR, Kế toán, Admin; HR cho nghỉ / tạo lại link cho Admin, chính mình, người giữ grant | 403; Admin làm được |
| SEC-HR-32 | Hạ / cho nghỉ Admin cuối cùng (kể cả 2 lệnh song song từ 2 Admin — xem CC-HR-17) | 409 `last_admin` |
| SEC-HR-33 | Thu `HR_MANAGE` ⇒ request kế tiếp (đọc + ghi) 403 ngay; lệnh ghi đang mở sau khóa 403, không ghi | đúng |
| SEC-HR-34 | Parity: grant không chứa `company:*`; `HR_MANAGE` ∌ `payroll:*`; `PAYROLL_MANAGE` ∌ `hr:*`; quyền ws ∩ quyền công ty = ∅; ma trận ws không còn `attendance:self`/`hr:*` | đúng |
| SEC-HR-35 | Nhân viên thường gọi mọi route `hr:manage`/`company:admin` với body sai; đọc công/đơn/số dư người khác; `GET hr/audit-logs` bởi HR | 403 (không 400); 403; 403 |
| SEC-HR-36 | IDOR: id đơn nghỉ / lượt chấm / thông báo của người khác qua route self; `userId` chưa từng là nhân viên trong route HR | 404 |
| SEC-HR-37 | Thêm thành viên ws: `userId` không phải nhân viên / đang có lịch nghỉ / đã nghỉ / chưa từng tồn tại; `member-candidates` bởi MEMBER; `q` = `%`/`_`/`\`, 1 000 ký tự | 422 `NOT_ACTIVE_EMPLOYEE` / 404; 403; khớp chữ thường; 400 |
| SEC-HR-38 | Admin không thuộc ws: mọi route `/workspaces/:wsId/…` dự án | 404 `workspace` (ADR-020); `admin/workspaces` chỉ trả tên/OWNER/số thành viên, không dự án/task |
| SEC-HR-39 | `POST auth/register` (mọi body); `GET /register` trên web; route cũ `/workspaces/:wsId/attendance/*`, `…/leave-requests`, `…/members/:id/grants` | 404; không trang; 404 |
| SEC-HR-56 | Token dùng lần 2 / hết hạn (7 ngày + 1 s) / bị thu hồi khi tạo lại ⇒ 410 `ACTIVATION_GONE`; token sửa 1 ký tự / rác ⇒ 400 `ACTIVATION_INVALID` (body giống nhau giữa các token sai) | đúng |
| SEC-HR-57 | 11 lần sai/15 phút/IP vào `activate` và `inspect`; thời gian đáp token có/không tồn tại không phân biệt (trung vị, LOG-04) | 429; đúng |
| SEC-HR-58 | User chờ kích hoạt: `login` (mọi mật khẩu, kể cả rỗng), `refresh`; người đã nghỉ: `login`, `refresh` bằng refresh token cũ, access token cũ | như user không tồn tại; 401 |
| SEC-HR-59 | Token không có trong audit, thông báo, log pino, Sentry, `GET hr/employees`, URL API; response thêm/tạo lại có `no-store`; không route GET đọc lại token; `/activate` xóa fragment, `Referrer-Policy: no-referrer` | đúng |
| SEC-HR-60 | **Bot xem trước:** GET trang `/activate#t=…` 5 lần + `inspect` 5 lần ⇒ token vẫn `activate` được; `inspect` không đổi `used_at` | đúng |
| SEC-HR-61 | Mật khẩu yếu ở `activate` ⇒ 422, token vẫn sống; activate thành công ⇒ phiên mới, token chết | đúng |
| SEC-HR-62 | Sau `offboard_access_until` (trước khi job chạy): route công ty 401, route ws 404 `workspace`, socket join bị từ chối; sau job: phiên bị thu hồi, `revokeWorkspaceAccess` đã phát | đúng |
| SEC-HR-63 | Thêm nhân viên lần 31/giờ; tạo lại link lần 11/giờ | 429 |
| SEC-HR-64 | Bootstrap: chạy lần 2 khi đã có Admin ⇒ thoát 1, không tạo Admin, không đổi mật khẩu; thiếu env ⇒ thoát lỗi, không user nào; `--reissue-link` khi Admin đã kích hoạt ⇒ thoát 1 | đúng |
| SEC-HR-65 | Body strict: `POST hr/employees` có `grants`/`role`/`joinedAt`/`userId`; `PUT admin/access` có `joinedAt` | 400 |

Threat-model §6 (B): **R27** đổi chủ thể sang "nhân viên công ty" (job retention bỏ ws; D5 ⇒ `company_member_departures`; thêm D10 token, D11 tài khoản chờ kích hoạt — như hr-extended §7) · **R26** "OWNER tự duyệt" ⇒ Admin · **R30** "người đã rời ws" ⇒ "người đã nghỉ việc" · **R36** thu hẹp (HR không còn nâng PM) · mới **R37** Admin có toàn quyền nhân sự/lương — cho nhiều Admin, audit Admin đọc, không ngầm quyền dự án · **R38** ai có shell/DB server chạy được `admin:bootstrap` (chấp nhận: cùng mức tin cậy hạ tầng; lệnh từ chối khi đã có Admin) · **R39** Admin tự gán mình OWNER workspace mồ côi ⇒ thấy dữ liệu dự án đó (chỉ khi mồ côi; audit + thành viên ws thấy trong danh sách).

## 6. Test (F cập nhật `test-spec-hr.md`; tầng như §0.1)

Dải T-053 lấy lại: CC-HR-16…19, CLK-HR-05…09, E2E-HR-15…19 (đều trước dải Mốc 5).

- **CO** đơn vị/tích hợp: CO-01 `effectiveCompanyPermissions` + parity contracts; CO-02 trạng thái suy ra (pending/offboarding/active/left); CO-03 tenure công ty: vào → nghỉ → nhận lại = 2 đoạn, ngày giữa = NOT_EMPLOYED; CO-04 hoàn tất nghỉ việc: departure đúng `left_at`, rời mọi ws (task bỏ gán), ws mồ côi gắn cờ, đơn nghỉ dọn đúng, phiên thu hồi, token thu hồi; CO-05 purge workspace không đụng bảng HR; CO-06 migration: backfill `company_members` từ user chưa xóa; CO-07 seed tạo đủ vai trò mẫu.
- **Viết lại** (F): ca theo ws của `test-spec-hr.md` (SEC-HR-01…29, CC-HR-01…15) đổi sang công ty; "OWNER ws có hr:manage" ⇒ Admin; cách ly HR giữa W1/W2 ⇒ phân quyền trong công ty; ca grant ws ⇒ `admin/access`.
- **SEC** SEC-HR-30…39, 56…65 (§5).
- **CC**: CC-HR-16 check-in song song (2 tab, cùng user) ⇒ đúng 1 IN; CC-HR-17 hai Admin hạ nhau song song ⇒ còn ≥ 1 Admin; CC-HR-18 job hoàn tất ‖ chấm Ra ngày cuối 05:59:59 ‖ HR hủy lịch ⇒ không 500, trạng thái nhất quán; CC-HR-19 2 `activate` cùng token ⇒ 1 phiên; 2 `POST hr/employees` cùng email ⇒ 1 tài khoản (thay CC-HR-26/27 của Mốc 5).
- **CLK**: CLK-HR-05 nghỉ việc `lastDay` = hôm nay: 05:59:30 hôm sau còn vào, 06:00:30 ⇒ 401/404 dù job chưa chạy; CLK-HR-06 link còn 30 s trước hạn 7 ngày dùng được, quá hạn 410; CLK-HR-07 `startDate` −31/−32/ngày mai; CLK-HR-08 `joined_at` = 00:00 theo lịch (kể cả `Europe/Berlin` DST); CLK-HR-09 nhận lại sau 1 tháng: tháng giữa không tính vắng.
- **E2E**: E2E-HR-15 Admin đăng nhập ⇒ `/w` thấy menu Nhân sự/Quản trị, thẻ chấm công, "Dự án của bạn"; nhân viên thường không thấy menu; ở 360 px không dịch > 8 px; E2E-HR-16 chấm Vào một lần ở `/w` ⇒ HR thấy ở "Hôm nay"; tạo workspace mới **không** cần chấm lại, HR vẫn thấy quyền; E2E-HR-17 HR thêm nhân viên ở 360 px ⇒ sao chép link ⇒ context mới mở link, đặt mật khẩu ⇒ vào `/w` ⇒ chấm công; E2E-HR-18 Admin cấp HR cho Mia ở `/admin/access` ⇒ Mia thấy menu Nhân sự không cần tải lại; E2E-HR-19 OWNER thêm thành viên bằng ô tìm nhân viên; HR cho nghỉ việc ⇒ sau 06:00 hôm sau (đồng hồ neo) người đó bị đăng xuất, ws mồ côi hiện ở `/admin/workspaces`, Admin gán OWNER. E2E-HR-14 vẫn xanh (đổi URL). axe cho mọi trang mới.
- Stryker `attendance-domain`, `leave-domain` chạy lại (domain không đổi — kỳ vọng giữ ≥ 90 %); thêm `company-domain` ≥ 90 %. Chỉ chạy khi TL báo "máy rảnh" (ADR-107).

## 7. Chia việc và thứ tự

| Vé | Ai | Nội dung | Phụ thuộc | Ước tính |
|---|---|---|---|---|
| T-061 | B | Migration 5 (§3, backfill); module `company`: roles + parity + contracts, `loadCompanyMember`, `authorizeCompanyWrite`, JOIN vào `loadMembership`; `/auth/me` công ty; xóa register (route, use case, limiter); login/refresh từ chối pending/không thuộc công ty; `admin:bootstrap` CLI (+ entry tsdown, runbook D); `admin/access`, `admin/workspaces`, `company`; bỏ grants ws; `member-candidates` + thêm thành viên theo `userId`; HrAuditLog/thông báo công ty; seed mới; threat-model R37–R39 | — **(đầu tiên)** | 2,5 ngày |
| T-062 | B | Vào làm / kích hoạt / nghỉ việc / nhận lại (ADR-137): `hr/employees`, token (đủ 5 điều khoản), `auth/activation/*`, hạn mức, job hoàn tất, `endMembership` dùng chung + `IWorkspaceExitPort`, thu hồi phiên `OFFBOARDED`, last-admin guard, port dọn đơn nghỉ; retention D10/D11, `data-retention.md` cập nhật R27 | T-061 | 2 ngày |
| T-063 | A | Attendance sang công ty: cherry-pick `punch-rules.ts` + `lockUserPunch` từ 62fcc74 (bỏ `workspaceId`), đổi port/use case/route §4, `ICompanyTenurePort`, `ICompanyAccess`, CSV, retention job bỏ ws, xóa route cũ + `/me/attendance`; harness attendance W1 ⇒ công ty; adapter `WorkCalendarPort` cho leave | T-061 | 1,5 ngày |
| T-064 | D | Leave sang công ty: route §4, khóa `taskflow:leave:<user>`, số dư PK `(user, year)`, adapter `ApprovedLeavePort`; adapter dọn đơn khi nghỉ việc cho T-062 | T-061 | 1 ngày |
| T-065a/b/c | E | (a) `/w` mới (menu theo quyền, thẻ chấm công, lối tắt, "Dự án của bạn"), chuyển `/attendance` `/leave` `/hr`, query key `['company', …]`, `useCompanyPermission`, `company:access-changed`; (b) `/hr/employees` (thêm + hộp link, tạo lại link, nghỉ việc/hủy, nhận lại, bộ lọc trạng thái), `/activate`, `/admin/*`; (c) trang Thành viên ws: bỏ công tắc HR, combobox nhân viên; xóa `/register` + link | a: T-061 contracts · b: T-062 · c: T-061; bắt đầu từ contracts + mock | 3–3,5 ngày |
| T-066 | F | Harness ADR-140 (`globalSetup` bootstrap, `Actors.createUser`, `newWorkspace`, bỏ `apiRegister`/`registerViaUi` ở 11 spec + 3 support, `actors.register` 58 chỗ/12 file, `defaultWorkspaceId` 31 chỗ); viết lại SEC/CC HR theo công ty; ca mới §6 | song song; E2E sau từng vé web | 2 ngày (harness ~1) |
| — | TL | `payroll.md` v3.2 và `hr-extended.md` v3 theo §8; `DECISIONS.md` ADR-133…140 (đánh dấu ADR-119 bị thay); đóng nhánh `feat/T-053-home-checkin`, `feat/T-053a-me-attendance` (sau cherry-pick), `test/T-042-t053-sec`; `attendance-leave.md` thêm dòng "bị thay một phần bởi company-level.md" | sau duyệt | ½ ngày |

Thứ tự merge: **T-061 → (T-063 ‖ T-064 ‖ T-062) → T-065b/c → T-066 phần E2E**; T-065a bắt đầu ngay khi contracts T-061 có. Sau đó mới Mốc 5 (T-054…) rồi Mốc 4 (T-048…) theo thứ tự đã chốt ở `hr-extended.md` §10 (đã đánh lại §8).

**Ước tính:** ≈ 4,5–5 ngày làm việc của cả đội. Đường găng: B (T-061 2,5 → T-062 2) và web E (~3,5). Tùy tải máy (ADR-107).

## 8. Tác động lên Mốc 4 và Mốc 5 (TL sửa sau khi duyệt, trước khi ai code)

**`payroll.md` v3.1 → v3.2:**
1. ADR-124: `MemberGrant.PAYROLL_MANAGE` ⇒ `CompanyGrant.PAYROLL_MANAGE` (đã khai ở migration 5); "OWNER ngầm có / chỉ OWNER cấp" ⇒ Admin; luật self "trừ OWNER" ⇒ "trừ Admin".
2. Bỏ `ws` khỏi mọi bảng: `PayrollSetting` một dòng (PK hằng như `companies`, hoặc cột trên `companies` — B chọn); `SalaryProfile @@unique(userId, effectiveFrom)`; `PayrollRun @@unique(period)`; `Payslip` bỏ `ws`. Khóa `taskflow:payroll:<period>`; chống lặp nhắc theo `(period, ngày)`.
3. Route `/api/v1/payroll/…`, `/api/v1/payslips/…`; web `/payslips`, `/payslips/YYYY-MM`, `/payroll/…` (không `/w/[ws]`). Đầu phiếu in **tên công ty** (`companies.name`) thay "TÊN WORKSPACE". Gợi ý nhãn "đã dùng trong workspace" ⇒ "trong công ty".
4. Nhiệm kỳ cho "người trong kỳ" / "Thêm người còn thiếu" đọc `company_member_departures` (ADR-133); nghỉ việc OFFBOARDED như cũ.
5. Audit `PAYROLL_*` chỉ Admin đọc. Migration payroll đánh số lại (xem dưới).

**`hr-extended.md` v2.1 → v3:**
1. **Chuyển sang mốc này** (ADR-137): thêm nhân viên + tài khoản chờ kích hoạt + link, `auth/activation/*`, cho nghỉ việc có lịch + job hoàn tất, hủy lịch, nhận lại (nhiệm kỳ mới), danh sách nhân viên theo trạng thái, `users.password_hash` nullable, `account_activation_tokens`, `OFFBOARD_SCHEDULED`, retention D10/D11, SEC-HR-56…65, CC-HR-26…27 (⇒ CC-HR-19), CLK-HR-15…16 (⇒ CLK-HR-05/06), E2E-HR-26…27 (⇒ E2E-HR-17/19). **T-060 bị xóa** (nội dung vào T-062).
2. **Bỏ hẳn:** `PATCH hr/employees/:userId {role}` (MEMBER↔PM) — vai trò dự án thuộc workspace; R36 thu hẹp.
3. **Ở lại Mốc 5, đổi phạm vi công ty:** ADR-128 `EmployeeProfile` PK `user_id` (bỏ `workspaceId`; "cùng user ở 2 ws có 2 hồ sơ" và SEC-HR-44 bỏ); form "Thêm nhân viên" thêm 4 trường hồ sơ + lựa chọn **giữ `hireDate` cũ** khi nhận lại (T-054); `profile:self` vào ma trận công ty. ADR-129 đơn bổ sung bỏ `workspaceId` (unique `(user, work_date, kind)` PENDING, `(user, idempotency_key)`), "người gửi vẫn là nhân viên (OWNER/PM/MEMBER)" ⇒ "còn thuộc công ty". ADR-130 xuất cả công ty (không tham số ws). ADR-131 `LeavePolicy` PK `year`; khóa `taskflow:leave-policy` (bỏ ws).
4. Mọi "OWNER" ⇒ "Admin"; route bỏ `/workspaces/:wsId/`; web bỏ `/w/[wsId]/my-profile` ⇒ `/my-profile`; tab "Nhân viên" của `/hr` là `/hr/employees` của mốc này, Mốc 5 chỉ thêm cột hồ sơ.
5. **Đánh lại migration:** 5 = `company_level` (T-061) · 6 = `hr_employee_profile` (T-054) · 7 = payroll (T-048) · 8 = đơn bổ sung (T-055) · 9 = chính sách phép (T-057). Timestamp đặt lúc merge.
6. `hireDate` (ngày vào công ty, có thể trước khi có hệ thống) vẫn ở `EmployeeProfile`; **nhiệm kỳ** chấm công/lương = `company_members.joined_at` + departures. Cả hai cấp công ty, tách khỏi membership dự án (A#1).

## 9. Câu hỏi cho người dùng

1. **Admin có phải nhân viên chấm công / xin nghỉ không?** Đề xuất: **có** (Admin vẫn có thẻ chấm công, có trong bảng công, tự duyệt đơn của mình được kèm lý do). Nếu không: Admin bị loại khỏi bảng công/lương.
2. **Workspace mồ côi** (OWNER duy nhất nghỉ việc): Admin được tự gán mình làm OWNER để giao lại cho người khác — đồng ý? (Admin khi đó thấy dữ liệu dự án đó; có ghi nhật ký.)
3. **DB local:** cho phép `migrate reset` + seed (mất toàn bộ dữ liệu local, thay bằng dữ liệu mẫu) — hay chỉ migrate (giữ tài khoản/dự án/task, mất dữ liệu chấm công/nghỉ phép)? Chưa chạy gì trên DB của bạn cho tới khi bạn trả lời.
4. **Tên công ty** dùng cho đầu phiếu lương và trang kích hoạt: nhập lúc chạy `admin:bootstrap`, Admin sửa được ở Quản trị → Công ty — chỉ cần bạn cho biết tên khi chạy lần đầu.

R27 Q2/Q4/Q5 vẫn mở như trước (trước deploy).
