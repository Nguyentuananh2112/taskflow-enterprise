# Đặc tả test — Mốc 3.5 "Cấp công ty" (T-066)

> **Căn cứ:** `docs/design/company-level.md` v2.1 (main `3d39d81`, ADR-133…140), `test-spec-hr.md` (Mốc 3), `docs/reviews/F-company-level-review.md`.
> **Chủ:** F (QA độc lập).
> **Trạng thái:** đặc tả, chưa có code. Harness code khi B commit contracts + `admin:bootstrap` (TL báo).
> **Nhánh:** `test/T-066-*` từ `feat/company-level`, merge vào `feat/company-level`.
>
> Dữ liệu ví dụ là bịa. Mã lỗi theo `test-spec-hr.md` §0.2b:
> - 409 `RESOURCE_CONFLICT` + `reason` viết thường;
> - 422 `BUSINESS_RULE_VIOLATION` + `rule` viết HOA.

## 0. Quy ước (thay §0 của `test-spec-hr.md` ở những điểm sau)

### 0.1 Tầng

Như `test-spec-hr.md` §0.1:

| Tầng | Nghĩa | Nơi chạy |
|---|---|---|
| **U** | hàm thuần | `*.test.ts` cạnh domain |
| **A** | use case + fake | |
| **I** | Postgres thật | `test/integration` |
| **S** | hộp đen bảo mật | `test/security`, mỗi file một process API + DB riêng |
| **C** | đua hộp đen ×20 | |
| **K** | đồng hồ neo, process riêng | `CLK-*` |
| **E** | Playwright | |
| **M** | Stryker | |

### 0.2 Bối cảnh chuẩn (thay §0.2)

Một công ty "Công ty Test". Mọi ca **tự tạo người**; không có ws mặc định.

| Tên | Vai trò công ty | Ghi chú |
|---|---|---|
| **Ada** | ADMIN (bootstrap) | không chấm công, không xin nghỉ (ADR-134) |
| **Hana** | EMPLOYEE + `HR_MANAGE` | |
| **Kay** | EMPLOYEE + `PAYROLL_MANAGE` | Mốc 4 dùng; ở đây chỉ để kiểm tách quyền |
| **Mia**, **Max** | EMPLOYEE | |
| **Nina** | EMPLOYEE chờ kích hoạt | `password_hash` NULL |
| **Quinn** | đã nghỉ | có departure |

**Workspace dự án:**

- **W1:** Mia OWNER, Max MEMBER, Vic VIEWER (Vic là EMPLOYEE công ty).
- **W2:** Otto OWNER. Ada **không** là thành viên.

### 0.3 Thứ tự lỗi route công ty (ADR-135)

1. 401 (không token / token sai);
2. 401 `SESSION_REVOKED` (không còn thuộc công ty: không có dòng, hoặc `access_until ≤ now`);
3. 403 (thiếu quyền; `permit` chạy TRƯỚC validate, nên body sai vẫn 403);
4. 400;
5. 404 tài nguyên con (`user` chưa từng có nhiệm kỳ EMPLOYEE);
6. 422 / 409.

Route dự án `/workspaces/:wsId/…` giữ thứ tự ADR-020: không là thành viên thì 404 `workspace`.

### 0.4 Luật cách ly khi một công ty (ADR-140)

Lịch, ngày lễ, danh sách nhân viên và người nhận thông báo HR là **chung** cho mọi ca trong một DB.

1. **Security:** DB riêng mỗi file (reset mỗi file). Ca **đổi lịch / ngày lễ** đặt ở file riêng (`company-calendar.sec.ts`, `*-clock-*.sec.ts`).
2. **E2E** (một DB cho cả lượt):
   - **cấm** đổi lịch công ty;
   - ngày lễ chỉ dùng ngày xa, cấp bằng `reserveDate()`, nên không hai ca nào trùng ngày;
   - suite HR chạy `workers: 1`, cả ở CI.
3. **Không khẳng định số dòng tuyệt đối** của danh sách toàn công ty ("Hôm nay", bảng công tháng, hàng đợi đơn, `hr/employees`).
   - Tìm người qua `q` / ô tìm, không dựa trang 1.
4. **Thông báo:** khẳng định theo **delta có lọc `refId`**: "có đúng 1 thông báo mới loại X với `refId` = id của ca". Không dùng "N chưa đọc" tuyệt đối, vì HR / Admin nhận thông báo của mọi ca.
5. **Hạn mức:** `createUser` gọi `flushRateLimitCounters()` trước mỗi vòng seed (thêm nhân viên 30/giờ/actor, `member-candidates` 60/giờ).
6. **Đồng hồ:** giờ nghiệp vụ neo thứ Ba 10:00 VN (`harness/clock.ts`). Bootstrap CLI nhận cùng `TEST_CLOCK_ANCHOR`. Ca cần nhảy ≥ 1 ngày thì **restart API với mốc tiến** trên cùng DB (§1.3).

## 1. Harness (ADR-140)

### 1.1 Bootstrap

- **Security:** `useApi(env)` `beforeAll`, theo thứ tự:
  1. `prepareSuiteDatabase` (reset);
  2. chạy `admin:bootstrap --json` với `DATABASE_URL` của suite, `TEST_CLOCK_ANCHOR`, `APP_ENV=test`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `COMPANY_NAME`;
  3. đọc dòng JSON duy nhất, cuối stdout: `{userId, activation: {token, link, expiresAt}}` (`link` = `<origin>/activate#t=<token>`, token phải khớp fragment; log CLI ra stderr — B chốt);
  4. khởi động API;
  5. `POST /auth/activate {token, password}` để có phiên Ada (`useCompanyApi`).
  - Lỗi bất kỳ bước nào thì cả file đỏ, có thông báo rõ.
- **E2E:** `globalSetup` làm đúng các bước đó **một lần**, ghi phiên Ada vào biến môi trường của worker.
- **Không** route test-only, **không** chèn DB.

### 1.2 Tạo người và workspace

```ts
// Ada: POST /hr/employees {email, fullName, startDate?}
//   ⇒ 201 {employee: {userId, status, version, startDate}, accountCreated, activation: {token, link, expiresAt} | null}
//   (activation = null khi NHẬN LẠI người đã có mật khẩu; harness dùng thẳng activation.token — contracts B 1bb5f42)
//   ⇒ POST /auth/activate {token, password} ⇒ access token (không login lại)
//   ⇒ (tuỳ chọn) PUT /admin/access/:userId {role, grants, expectedVersion: employee.version}
actors.createUser(label, { grants?: CompanyGrant[], admin?: boolean, pending?: boolean, startDate?: string })
// pending: dừng trước activate, trả { userId, token } để ca kích hoạt tự làm.
actors.newWorkspace(owner, name?)                    // POST /workspaces bởi owner
actors.addToWorkspace(owner, wsId, userId, role)     // POST /workspaces/:wsId/members {userId, role}
actors.offboard(hr, userId, lastDay)                 // PUT /hr/employees/:userId/offboarding
```

- **Bỏ:** `register`, `defaultWorkspaceId`, `addMember({email})`.
  - Alias `register` = `createUser` + `newWorkspace` sống tới khi chuyển xong 12 file, rồi xóa trong cùng PR cuối.
- E2E: `apiCreateUser` / `apiNewWorkspace` / `apiAddToWorkspace` thay `apiRegister` / `apiAddMember`. `registerViaUi` chỉ còn ở SEC-HR-39 / E2E (trang `/register` không tồn tại).

### 1.3 Restart với mốc tiến

```ts
await api.restart({ TEST_CLOCK_ANCHOR: shiftIso(anchor, 7 * DAY_MS - 30_000) })
// cùng DB, cùng Valkey db; phiên cũ còn hiệu lực theo giờ THẬT (JWT không theo giờ nghiệp vụ)
```

**Ràng buộc A (T-063):** API khởi động được với mốc **sau** dữ liệu đã ghi. Mốc chỉ tiến.

### 1.4 Helper khác

- **`nextVnDateAnchor('MM-DD', 'HH:mm:ss', tz?)`:** mốc theo **ngày** (đầu tháng, 31/12, ngày đổi giờ Berlin), luôn ở tương lai.
- **`reserveDate()` (E2E):** cấp ngày lễ xa (≥ +20 ngày làm việc từ mốc), mỗi lần một ngày mới, không trùng trong lượt chạy.
- **`newNotifications(actor, before, { type, refId })`:** `before = await notificationIds(actor)` chụp trước thao tác; sau đó đọc hết các trang `/me/notifications` và lọc id mới + `type` + `refId`. So theo **id**, không theo `createdAt` (giờ nghiệp vụ dời theo mốc, không so được với giờ máy).

### 1.5 Bố cục file

| File | Ca |
|---|---|
| `test/security/harness/company.ts` | `useCompanyApi`, `CompanyActors` (`createUser`, `activate`, `setAccess`, `newWorkspace`, `addToWorkspace`, `offboard`, `reissueActivation`, `newNotifications`); `api.restart` ở `suite.ts` |
| `test/security/harness/company-bootstrap.ts` | chạy CLI `admin:bootstrap --json`, đọc `{link, userId}`; không import vitest (dùng lại ở globalSetup E2E) |
| `test/security/company-access.sec.ts` | SEC-HR-30…35, 38, 65 |
| `test/security/company-idor.sec.ts` | SEC-HR-36, 37, 39 |
| `test/security/company-activation.sec.ts` | SEC-HR-56…61, 63 |
| `test/security/company-offboard.sec.ts` | SEC-HR-62 (vế hoàn tất trong request), 68 — D |
| `test/security/company-clock-0559.sec.ts` | mốc 05:59:10 (khe trước job): CLK-HR-05, SEC-HR-62b (sau 06:00), 69, 70 — D |
| `test/security/company-activation.sec.ts` | SEC-HR-56…61, 63, 63b — F |
| `test/security/company-races.sec.ts` | CC-HR-16…19, 26, 27 — F (CC-HR-18 vế job / 05:59:59 ở company-clock-0559) |
| `test/integration/company/session-revoke.int.ts` | SEC-HR-66 (tầng I, store token-version giả ném lỗi) |
| `test/security/company-bootstrap.sec.ts` | SEC-HR-64 (gọi CLI trực tiếp, không cần API) |
| `test/security/company-races.sec.ts` | CC-HR-16…19, 26, 27 |
| `test/security/company-clock-*.sec.ts` | CLK-HR-06…09 (mỗi mốc một file, `api.restart`) — B |
| `test/security/hr*.sec.ts` (có sẵn) | viết lại theo §6 |
| `e2e/specs/company.e2e.ts` | E2E-HR-15…19 |
| `e2e/specs/hr.e2e.ts` | E2E-HR-01…14 viết lại theo §6 |
| `apps/web` vitest | SEC-HR-67 (E) |

## 2. CO — đơn vị / tích hợp (B, A, D viết; F kiểm phủ + Stryker)

| ID | Tầng | Ca | Mong đợi |
|---|---|---|---|
| CO-01 | U | `effectiveCompanyPermissions(role, grants)` mọi tổ hợp + parity contracts ↔ api | ADMIN ⇒ `company:*`, `hr:manage`, `payroll:manage`, **không** `*:self`; EMPLOYEE ⇒ `attendance:self`, `leave:self`, `workspace:create`; `HR_MANAGE` chỉ thêm `hr:manage`; `PAYROLL_MANAGE` chỉ thêm `payroll:manage` |
| CO-02 | U | trạng thái suy ra (`PENDING_ACTIVATION` / `OFFBOARDING` / `ACTIVE` / `LEFT`) + `accessUntilOf(lastDay, schedule)` + `isCompanyAccessActive(now)` | `access_until` = 06:00 ngày sau `lastDay` theo múi giờ lịch; biên 05:59:59 / 06:00:00; Stryker `company-domain` ≥ 90 % |
| CO-03 | U | tenure theo ngày: vào → nghỉ → nhận lại | 2 đoạn; các ngày giữa ⇒ NOT_EMPLOYED; ngày `last_day` tính bình thường |
| CO-04 | I | hoàn tất nghỉ việc | `DELETE … RETURNING` đếm 1 ⇒ đúng 1 departure (`first_day`, `last_day`, `left_at` đúng); rời mọi ws (task bỏ gán); ws chỉ có người đó làm OWNER gắn cờ mồ côi; `offboardCleanup` đủ 3 nhánh (PENDING sau `lastDay` ⇒ CANCELLED, APPROVED bắt đầu sau ⇒ REVOKED, vắt qua ⇒ giữ) + **một** thông báo tổng; thu hồi phiên 3 bước (`token_version`, refresh token, Valkey **trước** commit; `disconnectUser` sau) |
| CO-05 | I | purge workspace | bảng HR không đổi (đếm trước/sau) |
| CO-06 | I | migration 5 trên DB có user (một có `deleted_at`) | backfill `company_members` cho user chưa xóa; user xóa mềm **không** có dòng; chưa có Admin ⇒ route `company:admin` 403, không 500 |
| CO-07 | I | seed | đủ Admin / HR / Kế toán / nhân viên / chờ kích hoạt / đã nghỉ + 2 ws; Ada không ở ws thứ hai |
| CO-08 | A+I | nâng EMPLOYEE → ADMIN ngày 15 | departure `ROLE_CHANGED` `last_day` = 15; ngày 15 tính công; 16+ không có trong bảng công; đơn sau 15 dọn; membership ws giữ nguyên |
| CO-09 | A+I | hạ ADMIN → EMPLOYEE ngày 20 | `start_date` = 21; ngày 20 NOT_EMPLOYED; IN ngày 20 ⇒ 422 `NOT_EMPLOYED` |
| CO-10 | A | IN trước `start_date` / ADJUSTMENT cho người đã nghỉ | IN ⇒ 422; ADJUSTMENT trong nhiệm kỳ cũ ⇒ 201; ngoài nhiệm kỳ ⇒ 422 |
| CO-11 | A | `AFTER_LAST_DAY` | submit / approve / preview đơn có ngày sau `lastDay` ⇒ 422 `AFTER_LAST_DAY` |
| LB-REHIRE | A+I | nhận lại cùng năm / năm khác | cùng năm: đơn trước `start_date` không trừ, `adjustmentDays` reset + audit; năm khác ⇒ như người mới |

## 3. SEC — hộp đen bảo mật (tầng S)

| ID | Kịch bản (cụ thể) | Mong đợi |
|---|---|---|
| **SEC-HR-30** | Leo quyền: Mia, Hana, Kay mỗi người `PUT admin/access/:self {role:'ADMIN'}` và `{grants:['HR_MANAGE']}`, và cùng lệnh cho Max; Hana `POST hr/employees` có `role` | 403 (body sai vẫn 403); 400 strict ở `POST hr/employees`; sau đó `GET /auth/me` của từng người không đổi |
| **SEC-HR-31** | Hana cấp/thu `HR_MANAGE`, `PAYROLL_MANAGE`, nâng ADMIN cho Max; Hana `PUT offboarding` / `activation-link` cho Ada, chính mình, Kay (giữ grant) | 403; Ada làm cùng lệnh ⇒ 200 |
| **SEC-HR-32** | Ada tự hạ / tự cho mình nghỉ (đã có Ada2); Ada2 hạ Ada khi chỉ còn Ada là Admin kia (hạ Admin cuối) | tự làm ⇒ 403; Admin cuối ⇒ 409 `last_admin`; Ada2 hạ Ada khi còn ≥ 2 Admin ⇒ 200 |
| **SEC-HR-33** | Ada thu `HR_MANAGE` của Hana; Hana dùng CÙNG access token gọi đọc (`attendance/today`) và ghi (`approve`); lệnh ghi đang chờ khóa lúc thu (vế đua: CC-HR-11 ở hr-races.sec) | 403 ngay request kế tiếp; lệnh ghi sau khóa 403, không ghi (đếm DB) |
| **SEC-HR-34** | Parity qua `/auth/me.company.permissions` của từng tổ hợp role/grant | grant ∌ `company:*`; `HR_MANAGE` ∌ `payroll:*`; `PAYROLL_MANAGE` ∌ `hr:*`; ADMIN ∌ `*:self`; không quyền ws nào trong tập công ty |
| **SEC-HR-35** | Mia gọi mọi route `hr:manage` / `company:admin` với body sai; Mia đọc công / đơn / số dư của Max qua route HR; Hana `GET hr/audit-logs`; Ada `POST attendance/check-in`, `POST leave/requests` | 403 (không 400); 403; 403; 403 |
| **SEC-HR-36** | IDOR qua route self: Max hủy đơn của Mia, đọc `me/events` với id lượt của Mia, `POST me/notifications/:id/read` id của Mia; Hana `GET attendance/events?userId=<chưa từng là nhân viên>` | 404 (không 403, không lộ tồn tại) |
| **SEC-HR-37** | Mia (OWNER W1) thêm vào W1: `userId` không thuộc công ty (qua API chỉ có id lạ ⇒ 404 `user`) / Quinn (đã nghỉ) / người sắp nghỉ / Nina (chờ kích hoạt) / Ada (Admin hoạt động); Max (MEMBER) gọi `member-candidates`; `q` = `%`, `_`, `\`, 1 000 ký tự; lần 61/giờ | 422 `NOT_ACTIVE_MEMBER` / 422 / 422 / **201** / **201**; 403; `%` `_` `\` khớp chữ thường (không trả cả danh sách); 400; 429 |
| **SEC-HR-38** | Ada gọi route dự án W2 (không là thành viên); Ada là thành viên W1 ⇒ theo role W1; `admin/workspaces` chỉ có tên / OWNER / số thành viên (không project / task); `owner` với `userId` ngoài ws, Ada tự nhận khi không là thành viên, ws còn OWNER, ws xóa mềm; `archive` ws còn thành viên; nâng Max lên Admin ⇒ membership W1 của Max giữ nguyên | 404 `workspace`; đúng role; không lộ dữ liệu dự án; 422 / 422 / 409 `workspace_has_owner` / 409; 409; giữ |
| **SEC-HR-39** | `POST auth/register` (mọi body, kể cả hợp lệ cũ); `GET /register` (web); route cũ `/workspaces/:wsId/attendance/*`, `…/leave-requests`, `…/members/:id/grants`, `…/hr-audit-logs`, `/me/attendance/*`; Ada cấp grant cho Mia ⇒ không có event `member:grants-changed` (chỉ `company:access-changed`) | 404 chung của router (không lộ email); không trang; 404; đúng |
| **SEC-HR-56** | Token dùng lần 2; hết hạn (CLK-HR-06); bị thu hồi do "tạo lại link"; token sửa 1 ký tự; rác 3 độ dài | 410 `ACTIVATION_GONE` ×3; 400 `ACTIVATION_INVALID` ×2, **body giống hệt nhau** (so JSON trừ `meta`) |
| **SEC-HR-57** | 11 lần token sai / 15 phút / IP vào `activate` và `inspect`; đo 30 lần mỗi loại (token tồn tại nhưng mật khẩu yếu vs không tồn tại) | lần 11 ⇒ 429; trung vị thời gian không lệch quá ngưỡng LOG-04 |
| **SEC-HR-58** | Nina (chờ kích hoạt) `login` với mọi mật khẩu kể cả rỗng, `refresh`; Quinn (đã nghỉ) `login`, `refresh` bằng refresh token cũ, access token cũ gọi route công ty | như user không tồn tại (cùng mã / body / thời gian); 401; 401 `SESSION_REVOKED` |
| **SEC-HR-59** | Token (số canh) không có trong: audit, thông báo, stdout pino của API, Sentry (API + web — sự kiện ném lỗi trên `/activate`), `GET hr/employees`, URL của mọi request API; response thêm / tạo lại link có `no-store`; không route GET nào trả token; `/activate` có `Referrer-Policy: no-referrer` và xóa fragment khỏi URL sau khi tải | đúng (S + E) |
| **SEC-HR-60** | Bot xem trước: GET `/activate#t=…` 5 lần (context không JS) + `inspect` 5 lần | token vẫn `activate` được; `inspect` không đổi `used_at` (đọc qua `activate` thành công) |
| **SEC-HR-61** | `activate` mật khẩu yếu; rồi mật khẩu tốt; rồi dùng lại | 400 `VALIDATION_ERROR` (B: policy trước transaction), token vẫn sống; 200 + phiên mới; 410 |
| **SEC-HR-62** | (a) Hoàn tất trong request (`lastDay` quá khứ): token cũ gọi route công ty, route W1, `refresh`, socket handshake; socket đang nối. (b) **SEC-HR-62b** (file 05:59:10, khe sau `access_until` trước job): cùng các lệnh với token còn hợp lệ | (a) 401 `UNAUTHORIZED` (token_version tăng — tầng xác thực, trước membership) ở mọi route; refresh 401 `REFRESH_TOKEN_INVALID`; handshake từ chối; socket bị ngắt. (b) 401 `SESSION_REVOKED`; route W1 404 `workspace`; refresh 401; handshake / join từ chối |
| **SEC-HR-63** | Hana thêm nhân viên lần 31 / giờ; tạo lại link cho một người lần 11 / giờ | 429 + `Retry-After` |
| **SEC-HR-64** | (64b "email của nhân viên đã có mật khẩu ⇒ nâng ADMIN" cần trạng thái "chưa có Admin" — API không tạo được ⇒ tầng I)  Bootstrap (CLI, không API): lần 2 khi đã có Admin; thiếu từng env; không TTY và không `APP_ENV=test`; `--reissue-link` khi Admin đã kích hoạt; email của nhân viên đã có mật khẩu | thoát 1 + "Đã có Admin", DB không đổi; thoát lỗi, không user; từ chối; thoát 1; nâng ADMIN, mật khẩu giữ, không token |
| **SEC-HR-65** | Body strict: `POST hr/employees` có `grants` / `role` / `userId` / `startDate` tương lai / −32 ngày; `PUT admin/access` có `startDate` / `userId` | 400 / 422 (`startDate` ngoài khoảng) |
| **SEC-HR-66** | **Tầng I, không phải S** (TL: KHÔNG dừng Valkey dùng chung). Integration với Postgres thật + store token-version **giả** (test double inject qua composition) ném lỗi ở `setTokenVersion` khi: hoàn tất nghỉ việc, Admin hạ Admin, nâng lên Admin | transaction rollback: không departure, `company_members` / role / grants không đổi, refresh token không bị revoke nửa vời, không `disconnectUser`; gọi lại khi store hết lỗi ⇒ thành công trọn vẹn (job thử lại); ca thành công: access token cũ bị từ chối ngay (đọc `token_version` mới), `disconnectUser` được gọi đúng một lần |
| **SEC-HR-68** | Nhận lại Quinn: refresh token / access token cũ trước khi nghỉ; mật khẩu cũ; trước khi nhận lại | không sống lại (401); đăng nhập được sau khi nhận lại; trước đó như không tồn tại |
| **SEC-HR-69** | (B HIGH-2a) `POST /auth/refresh` bằng refresh token **còn hạn**, trong khe sau `access_until` trước khi job chạy | 401; không cấp access token; không xoay token (token cũ vẫn bị coi là không hợp lệ ở lần sau) |
| **SEC-HR-70** | (B HIGH-2b) Socket của Mia đã join phòng W1 và `user:{id}` trước `access_until`; sau 06:00, OWNER khác đổi task W1 | socket bị ngắt trong ≤ ~70 s; event phát sau khi ngắt không tới; nối lại ⇒ handshake bị từ chối |

**SEC-HR-67** (web: 401 `SESSION_REVOKED` ⇒ về `/login`, xóa cache `['company']`, không gọi `refresh` lặp) ở vitest web của E. F kiểm có ca, và E2E-HR-19 phủ đầu–cuối.

## 4. CC — đua (tầng C, ×20, gom vòng đỏ, `SEC_HR_RACE_RUNS`)

| ID | Ca | Mong đợi |
|---|---|---|
| CC-HR-16 | Mia check-in 2 tab song song (key khác; rồi cùng key) | khác key: một 201 + một 409 `already_checked_in`; cùng key: một 201 + một 200 replay; luôn đúng 1 IN |
| CC-HR-17 | Ada và Ada2 hạ nhau song song (chỉ còn hai Admin) | đúng 1 thành công; bên thua 403 (đã mất quyền — `lockAdmins` tuần tự hóa) / 401 (phiên bị thu hồi) / 409 `last_admin`; luôn còn đúng ≥ 1 Admin, không 5xx |
| CC-HR-18 | `PUT offboarding` `lastDay` quá khứ (hoàn tất trong request) ‖ job hoàn tất ‖ Mia chấm Ra (05:59:59, K) ‖ Hana `DELETE offboarding` | đúng **một** departure, một `endMembership`, không 500; trạng thái cuối nhất quán (nghỉ **hoặc** còn làm, không nửa vời) |
| CC-HR-19 | 2 `activate` cùng token; 2 `POST hr/employees` cùng email | một phiên + một 410; một tài khoản + một 409 `already_employee` |
| CC-HR-26 | hoàn tất nghỉ việc ‖ Mia gửi đơn ×20 | sau hoàn tất không còn đơn PENDING nào sau `lastDay` của Mia |
| CC-HR-27 | ws mồ côi (OWNER duy nhất nghỉ): Ada giao OWNER cho hai thành viên song song ("thêm lại" chỉ đi qua `admin/workspaces/:id/owner` — ws mồ côi không ai có `member:add`) | đúng một OWNER, bên kia 409 `workspace_has_owner`, không 5xx |

## 5. CLK — đồng hồ neo (tầng K, mỗi file một process / mốc)

| ID | Mốc | Kịch bản | Mong đợi |
|---|---|---|---|
| CLK-HR-05 | thứ Ba 05:59:00 | Hana đặt `lastDay` của Mia = **hôm qua** (⇒ `access_until` 06:00 hôm nay) | 05:59:30: Mia gọi route công ty 200; chờ qua 06:00:30 ⇒ 401 `SESSION_REVOKED`, route W1 404 — job chưa chạy cũng vậy |
| CLK-HR-06 | thứ Ba 10:00 → **restart** mốc + 7 ngày − 30 s → mốc + 7 ngày + 30 s | tạo link; restart; `activate` | trước hạn ⇒ 200; restart quá hạn ⇒ 410 `ACTIVATION_GONE` |
| CLK-HR-07 | thứ Ba 10:00 | `POST hr/employees` `startDate` = −31 / −32 / ngày mai | 201 / 422 / 422; −31 ⇒ ngày 1…31 trước có thể NOT_EMPLOYED → tính từ `start_date`, cảnh báo ngày vắng trong response |
| CLK-HR-08 | ngày đổi giờ `Europe/Berlin` (cuối tháng 3 / tháng 10, `nextVnDateAnchor`) | lịch công ty múi Berlin; thêm nhân viên `startDate` hôm nay; cho nghỉ `lastDay` = hôm nay | `start_date` là ngày Berlin; `access_until` = 06:00 Berlin ngày sau (đúng offset sau đổi giờ) |
| CLK-HR-09 | thứ Ba 10:00 → **restart** mốc + 31 ngày | Mia nghỉ (`lastDay` hôm qua); restart; nhận lại; đọc bảng công tháng | các ngày giữa hai nhiệm kỳ ⇒ NOT_EMPLOYED, không phải ABSENT; tổng "Vắng" không tính chúng |

CLK-HR-01…04 (Mốc 3) giữ nội dung, đổi đường dẫn sang công ty. CLK-HR-03 do Hana thêm ADJUSTMENT, không còn OWNER tự thêm.

## 6. Viết lại ca Mốc 3 (F) — bảng chuyển

**Ký hiệu:**

- **P:** chỉ đổi path / actor.
- **R:** viết lại nội dung.
- **X:** bỏ, nêu lý do và ca thay thế.

### 6.1 SEC-HR-01…29

| ID | Loại | Chuyển thành |
|---|---|---|
| 01 | R | "Otto W2 ⇒ 404" bỏ nghĩa (một công ty). Mới: Otto (EMPLOYEE thường) gọi route `hr:manage` ⇒ 403. Cách ly dự án giữ ở SEC-xx workspace |
| 02 | P | route mới; 403 trước 400 |
| 03 | P | `attendance/me?userId=` vẫn chỉ của mình |
| 04 | R | IDOR W1↔W2 ⇒ IDOR giữa người (= SEC-HR-36) |
| 05, 06 | P / R | 06 "Vic VIEWER check-in ⇒ 403" **đảo**: Vic là EMPLOYEE ⇒ 201. Ada check-in ⇒ 403 (SEC-HR-35) |
| 07 | R | "trừ OWNER" ⇒ "trừ Admin"; Admin không có đơn / lượt của mình (không phải nhân viên) ⇒ ca self chỉ còn cho HR (403) |
| 08 | R | "Pam PUT grants" ⇒ SEC-HR-30 / 31 |
| 09, 10 | P | thu grant qua `admin/access` |
| 11–15, 21–24, 26, 28 | P | path; 11 CSV không còn "tên ws" trong ô |
| 13 | P | hạn mức theo user (bỏ "+ ws") |
| 16 | R | audit chỉ **Admin** đọc |
| 17, 19, 20 | P / R | 20: payload `notification:new` bỏ `workspaceId`; `member:grants-changed` ⇒ `company:access-changed` |
| 18 | R | "bị xóa khỏi ws ⇒ mất thông báo" bỏ (thông báo HR không theo ws). Mới: người đã nghỉ (hoàn tất ⇒ thu hồi phiên) ⇒ token cũ `me/notifications` 401 `UNAUTHORIZED` (route không có cổng công ty), refresh 401 `REFRESH_TOKEN_INVALID`; `SESSION_REVOKED` chỉ ở route công ty / `auth/me` / socket và khe "quá access_until, job chưa chạy" (SEC-HR-69) — B, T-062 |
| 25 | R | `userId` W2 ⇒ `userId` chưa từng là nhân viên ⇒ 404 |
| 27 | R | `GRANT_NOT_ALLOWED` cho OWNER / VIEWER ⇒ grant cho ADMIN ⇒ 422 (Admin ngầm có) |
| 29 | P | `userId` chưa từng có nhiệm kỳ ⇒ 404 |

### 6.2 CC-HR-01…15

| ID | Loại | Chuyển thành |
|---|---|---|
| 01–13 | P | path + khóa `taskflow:leave:<user>` / `taskflow:attendance:punch:<user>` |
| 14 | X | "VIEWER ‖ grant" hết nghĩa (VIEWER là role dự án). Thay: nâng Admin ‖ cấp grant ⇒ không bao giờ ADMIN có grant (CHECK `role = 'EMPLOYEE' OR grants = '{}'`) |
| 15 | X | departure ws ⇒ CO-04 + CC-HR-18 |

### 6.3 E2E-HR-01…14

| ID | Loại | Chuyển thành |
|---|---|---|
| 01, 05, 10–13 | R | thẻ / dialog chuyển từ `/w/:ws/projects` sang `/w` (thẻ gọn) và `/attendance` (thẻ đầy đủ); nút Vào/Ra gọn trên header |
| 02, 02b, 08, 08b | P | `/leave`, `/hr` gốc; chuông theo delta lọc `refId` |
| 03 | R | công tắc grant ở `/admin/access`; event `company:access-changed` |
| 04 | R | **đảo:** VIEWER dự án **có** thẻ chấm công (là nhân viên). Ca mới: Ada không có thẻ / không lối tắt self (= một phần E2E-HR-15) |
| 06, 07 | P | `/hr` gốc; tìm Mia qua ô tìm |
| 09 | P | `/w` + `/attendance` |
| 14 | R | đo `/w` (thẻ gọn + Việc quản lý + Workspace) ở 360 / 768 / 1280, cả nhân viên lẫn HR |

### 6.4 SEC chung (ngoài HR) — bỏ `/auth/register` và `members {email}`

Mọi file dùng `useCompanyApi()`; `actors.register(label)` là alias `createUser` + `newWorkspace` (§1.2) nên thân ca giữ nguyên. Thêm thành viên gửi `{userId, role}`. Ca gọi thẳng route cũ:

| Ca | Loại | Chuyển |
|---|---|---|
| SEC-32 (`auth.sec.ts`) | R | chính sách mật khẩu kiểm ở `POST auth/activate`: 5 mật khẩu sai trên **cùng** token ⇒ 400 `VALIDATION_ERROR`, không phản chiếu; token đó vẫn kích hoạt được bằng mật khẩu đúng (sai không tiêu token); 12 / 256 / tiếng Việt 12 ký tự ⇒ 200 |
| SEC-40 (`tenant.sec.ts`) | R | 5 owner tạo ws trùng tên song song ⇒ 5 × 201, 5 slug khác nhau; Ada thêm 5 nhân viên trùng email song song ⇒ `[201, 409×4]`, `hr/employees?q=` đúng 1 dòng |
| SEC-28b (`valkey-outage.sec.ts`) | R | Valkey tắt ⇒ `login` **và** `auth/activate` 503 `SERVICE_UNAVAILABLE` (fail-closed luồng công khai), API đã xác thực vẫn 200 |
| SEC-13, SEC-47 (`tenant.sec.ts`) | P | body `{userId, role}` |
| SEC-HR-39 | mới | `POST auth/register`, `members {email}` ⇒ 404 / 400 (§3) |

## 7. E2E mới (tầng E, `workers: 1` cho suite HR)

| ID | Ca | Mong đợi |
|---|---|---|
| E2E-HR-15 `@main` | Ada đăng nhập ⇒ `/w`; Mia đăng nhập ⇒ `/w` | Ada: "Việc quản lý" (Nhân sự, Quản trị), **không** thẻ chấm công, không lối tắt self, "Workspace của bạn" chỉ ws Ada là thành viên; Mia: thẻ gọn + lối tắt, không "Việc quản lý" |
| E2E-HR-16 `@main` | Mia chấm Vào ở `/w` (rồi lặp bằng nút header ở trang khác ⇒ đã vào); Hana `/hr` "Hôm nay" tìm "Mia"; Mia tạo workspace mới | Hana thấy Mia "Đang làm"; tạo ws không cần chấm lại, thẻ vẫn "Chấm ra" |
| E2E-HR-17 | Hana thêm nhân viên ở 360 px (tên chứa payload XSS) ⇒ hộp link ⇒ sao chép (clipboard) ⇒ context mới mở link ⇒ đặt mật khẩu ⇒ `/w` ⇒ chấm công | tên chỉ là text ở `/activate`, `/hr/employees`, chuông; fragment bị xóa khỏi URL; không request nào chứa token trong URL (bắt `page.on('request')`) |
| E2E-HR-18 | Ada cấp `HR_MANAGE` cho Mia ở `/admin/access` (Mia đang mở `/w`) | Mia thấy "Nhân sự" không tải lại; thu lại ⇒ mất ngay, cache `['company', 'hr', …]` bị xóa (vào `/hr` ⇒ không có quyền) |
| E2E-HR-19 | Mia (OWNER W3) thêm Max bằng combobox; Hana cho Mia nghỉ `lastDay` = **quá khứ** (TL chọn (b): hoàn tất ngay trong request, không cần mốc 06:00 — biên 06:00 ở CLK-HR-05 hộp đen) | tab của Mia: thao tác kế tiếp ⇒ về `/login` (401 `SESSION_REVOKED`, không lặp refresh); W3 mồ côi ở `/admin/workspaces`; Ada giao OWNER cho Max; Max thấy role OWNER |

- **axe** 0 serious / critical, sáng + tối: `/w` (Ada, Mia), `/activate`, `/hr/employees`, `/admin/access`, `/admin/workspaces`, `/admin/company`.
- **Responsive** 360 / 768 / 1280 cho cùng các trang.

## 8. Stryker (tầng M — chỉ khi TL báo "máy rảnh")

- `company-domain` mới ≥ 90 %: `effectiveCompanyPermissions`, trạng thái suy ra, `accessUntilOf`, `isCompanyAccessActive`, luật last-admin nếu ở domain.
- `attendance-domain`, `leave-domain` chạy lại, vì `tenure.ts` đổi sang ngày. Giữ ≥ 90 %.

## 9. Kế hoạch chuyển (T-066)

1. **Harness** (khi B commit contracts + bootstrap):
   - `harness/company.ts` (§1);
   - `useApi` thêm bước bootstrap;
   - E2E `globalSetup`;
   - `restart`, `nextVnDateAnchor`, `reserveDate`, `newNotifications`.
2. **Ca mới §3–§5** khai pending theo vé (`T-061` / `T-062` / `T-063` / `T-064`) ⇒ chạy bằng `SEC_RUN_PENDING=<vé>` khi vé merge vào `feat/company-level`.
3. **Chuyển 12 file security** theo §6:
   - ca P làm ngay sau T-063 / T-064;
   - ca R sau T-061;
   - ca X xóa cùng PR với ca thay thế.
4. **E2E:**
   - `apiCreateUser`, bỏ `registerViaUi` ở 11 spec + 3 support;
   - §6.3 + §7 theo từng vé web T-065a / b / c.
5. **Cổng:** mỗi bước xin lượt TL (ADR-107); job nặng chỉ khi TL báo.
   - Thời gian suite tăng ~1,3–1,5× (2 request / người).

## 10. Đã chốt (TL 1f, 2026-10-17)

1. **E2E-HR-19:** phương án (b). Biên 06:00 ở CLK-HR-05 (hộp đen); E2E dùng `lastDay` quá khứ, hoàn tất ngay trong request.
2. **Response `POST hr/employees`** (B chốt, contracts 1bb5f42): `201 { employee: { userId, status, version, startDate }, accountCreated, activation: { token, link, expiresAt } | null }`, `null` khi nhận lại người đã có mật khẩu. `activation-link` ⇒ `{ activation }`; `ActivateBody { token, password }` ⇒ `ActivateResponse { accessToken, expiresIn, user }`; `SetAccessBody { role, grants, expectedVersion }` strict, version lấy từ `employee.version`. Mã lỗi: `SESSION_REVOKED` 401, `ACTIVATION_INVALID` 400 (cùng body cho mọi token sai), `ACTIVATION_GONE` 410.
3. **SEC-HR-66:** không dừng container Valkey (hạ tầng dùng chung). Ca ở tầng integration với store token-version giả ném lỗi (§3, §1.5).
