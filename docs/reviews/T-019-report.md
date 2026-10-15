# T-019 — Báo cáo: xác thực phía web (đăng ký, đăng nhập, phiên) trên mock API

**Người làm:** Engineer E (`taskflow-enterprise-37`) · **Branch:** `feat/T-019` (từ main `6378fef`) · **Ngày:** 2026-10-15

## 1. Việc 0 — follow-up review T-012 (commit riêng `e04875d`)
- **ADR-101:** `upgrade-insecure-requests` và HSTS bật theo `APP_ENV ∈ {staging, production}` (`enforcesHttps()` trong `csp.ts`; `proxy.ts` truyền `appEnv`). `NODE_ENV` chỉ còn quyết định phần nới cho HMR (W-CSP-3). Có test cho đủ 4 giá trị `local/test/staging/production`, và test khẳng định build prod với `APP_ENV=test` không có `unsafe-eval`. Đã kiểm trên `next start` với `APP_ENV=local`: header không có HSTS và không có `upgrade-insecure-requests`.
- **ADR-102:** envelope lỗi hợp lệ nhưng `error.code` không có trong `ErrorCode` ⇒ `UNKNOWN_ERROR`, giữ `status`/`message`/`requestId`; mã gốc lưu ở `ApiError.serverCode` (chỉ để log). Vỏ envelope vẫn parse chặt bằng `ApiError.extend({ error: ApiErrorBody.extend({ code: z.string() }) })` của contracts. `BAD_RESPONSE` chỉ dành cho body không phải envelope (có test: thiếu `meta`, không phải JSON, sai `data`).

## 2. Việc chính
### 2.1 Mock API bằng MSW 3.0.3 (`src/app/mock-api/`)
- **Một bộ handler, hai nơi dùng:** test dùng `setupServer` (`test/mock-api.ts`); dev dùng **route handler cùng origin** `app/mock-api/v1/[...path]/route.ts`, gọi `getResponse(handlers, request)` của MSW. Bật bằng `APP_MOCK_API=1` + `API_URL=http://localhost:3001/mock-api/v1` (đã ghi trong `.env.example`).
- **Mock "khó tính" như server:** body được parse bằng **chính schema contracts** (`RegisterBody`, `LoginBody`, `UpdateMeBody`, `ChangePasswordBody` — strict, NFC, đếm code point). Lỗi được trả qua `toValidationIssues` của contracts, nên không chứa `input` (ADR-096). **Mọi response cũng được parse bằng `apiSuccess(schema)`/`ApiError` trước khi trả**, nên mock không thể trả dữ liệu mà server thật không được phép trả.
- Hành vi phiên giống security.md: cookie `tf_rt` HttpOnly, `SameSite=Strict`, `Path=<base>/auth`; refresh xoay vòng theo family; có cửa sổ ân hạn 10s (`409 REFRESH_IN_PROGRESS`); dùng lại token cũ sau 10s ⇒ thu hồi cả family; `logout-all`/đổi mật khẩu tăng `tokenVersion` ⇒ access token cũ thành `UNAUTHORIZED`; `TOKEN_EXPIRED` chỉ khi token hết hạn; đăng nhập sai 5 lần ⇒ `429 RATE_LIMITED {retryAfterSec}`; mật khẩu phổ biến hoặc chứa phần local của email ⇒ `VALIDATION_ERROR` tại `password`; `INVALID_CURRENT_PASSWORD` trả 400.
- **Kiểm chứng MSW 3 × vitest 5 × jsdom 30** (điểm "chưa kiểm" V11 trong frontend.md): chạy tốt. Hai phát hiện: (1) MSW 3 **không tự giữ cookie** của response giả, `Set-Cookie` vẫn đọc được ⇒ test dùng một cookie jar nhỏ mô phỏng trình duyệt (chỉ gửi/nhận khi `credentials: 'include'` và khớp `Path`); (2) MSW 3 đổi `onUnhandledRequest` → **`onUnhandledFrame`**. Tên cũ bị bỏ qua âm thầm khi chạy, chỉ `tsc` mới bắt được.

### 2.2 Phiên phía client (`src/entities/session/`)
- `token-store.ts`: access token chỉ nằm trong biến module (ADR-026, W-TOKEN-1). **Không** xuất ra public API của slice. Có test khẳng định state phiên (thứ React đọc) không chứa token.
- `refresh.ts`: single-flight trong tab + Web Locks `tf-refresh` xuyên tab (không có `navigator.locks` thì chỉ trong tab). `409 REFRESH_IN_PROGRESS` ⇒ đợi 300ms, thử lại đúng 1 lần. `REFRESH_TOKEN_INVALID`/`ORIGIN_NOT_ALLOWED` ⇒ mất phiên. Lỗi mạng ⇒ ném (tạm thời).
- `auth-channel.ts`: `BroadcastChannel('tf-auth')` chỉ chở `{type: 'login' | 'logout'}`, không bao giờ chở token. Message lạ bị bỏ qua.
- `session.ts`: `bootstrap()` (refresh → `/auth/me`; lỗi mạng ⇒ `unreachable`, **không** đẩy về `/login`), `signIn`, `logout` (luôn kết thúc phiên kể cả khi request lỗi), `logoutAll` (lỗi ⇒ giữ phiên để thử lại), `replaceToken` (đổi mật khẩu), `onEnded`. Cắm vào `http` qua `setAuthHooks`. **Chỉ refresh khi gặp `TOKEN_EXPIRED`** (đúng ticket) — không có hẹn giờ refresh chủ động (xem QĐ-3).
- `shared/api`: thêm `cookieHttp` (client không gắn hook auth) cho `/auth/refresh` và `/auth/logout`. Nếu đi qua `http`, request refresh sẽ xếp hàng chờ chính lần refresh đang chạy ⇒ treo vĩnh viễn.

### 2.3 Màn hình và tính năng
- Route: `(auth)/layout` dùng **GuestGate** (`/login`, `/register`); `(app)/layout` dùng **AuthGate** + AppShell (`/w`, `/account`).
- **GuestGate là nơi duy nhất điều hướng sau đăng nhập** (đăng nhập, đăng ký, phiên sẵn có, tab khác vừa đăng nhập), tới `?next=` đã qua `safeNextPath` (chống open redirect: `//x`, `/\x`, `https:`, ký tự điều khiển).
- Features: `auth-login`, `auth-register`, `auth-logout` (đăng xuất + đăng xuất mọi thiết bị có dialog xác nhận), `profile-edit` (PATCH `/auth/me`, ADR-083), `change-password`. Form dùng `react-hook-form` 7.90.0 + `@hookform/resolvers` 5.9.1 với schema contracts. Lỗi server đổ vào field qua `shared/lib/form-errors.ts` (`VALIDATION_ERROR.issues` theo `path[0]`; `EMAIL_ALREADY_EXISTS`→email; `INVALID_CURRENT_PASSWORD`→currentPassword; `INVALID_CREDENTIALS` là lỗi gốc, không chỉ ra trường nào sai; `RATE_LIMITED` báo số giây; 5xx/`UNKNOWN_ERROR` dùng câu chung).
- Widget `app-header`; view `login`, `register`, `workspace-picker` (`/w`: liệt kê workspace từ `/auth/me`), `account`. `shared/ui`: thêm `Alert` và `AuthCard`. `shared/query`: `createQueryClient` theo §3.1.
- **Dọn khi phiên kết thúc** (`SessionEffects` ở providers): `queryClient.clear()`; hết hạn/bị thu hồi ⇒ toast "Phiên đăng nhập đã hết"; AuthGate đưa về `/login?next=`.

## 3. Kiểm chứng
### Test (vitest)
- Unit (số trong ngoặc = số ca, tính cả từng dòng của `it.each`): `refresh` (8 — single-flight 5→1, khóa `tf-refresh`, 409 ⇒ thử lại đúng 1 lần, 409×2 ⇒ ném, mất phiên ⇒ null, lỗi mạng ⇒ ném), `auth-channel` (4), `session` (11 — bootstrap ok/khách/mạng + thử lại, gọi 2 lần chỉ chạy 1, hook http, logout/logoutAll, đa tab 2 chiều không vòng lặp), `safe-next-path` (15), `form-errors` (8), mock API (16), http (thêm ca UNKNOWN_ERROR, refresh lỗi mạng giữ phiên).
- Component + axe: LoginForm (5), RegisterForm (4 — gồm mật khẩu 12 ký tự tiếng Việt có dấu hợp lệ), ChangePasswordForm (2), view login/register.
- **Tích hợp** `test/auth-flow.test.tsx` (cây app thật: AppProviders + gate + view, router giả): khách vào `/w` ⇒ `/login?next=%2Fw` ⇒ **đăng ký ⇒ dashboard `/w`** ⇒ **reload giữ phiên** bằng cookie ⇒ access token hết hạn khi sửa họ tên ⇒ `TOKEN_EXPIRED` → refresh **đúng 1 lần** → gửi lại thành công (đã khẳng định bằng spy) ⇒ **đăng xuất** ⇒ cookie bị xóa, reload vẫn là khách. Thêm 2 ca: đăng xuất mọi thiết bị xóa cache; `?next=//evil` bị bỏ.

### Trình duyệt thật (Chrome, `next start` build prod, `APP_MOCK_API=1`, cổng 3001)
- Khách vào `/w` ⇒ `/login?next=%2Fw`. Đăng ký ⇒ `/w` hiện "Workspace của …" (Chủ sở hữu). Reload ⇒ vẫn đăng nhập. Đã đăng nhập mà mở `/login` ⇒ về `/w`.
- `document.cookie` rỗng (refresh cookie HttpOnly); `localStorage`/`sessionStorage` rỗng; không có khóa `token` trên `window`; HTML không chứa access token; **0 vi phạm CSP**.
- **Đa tab:** tab 2 mở `/account`; đăng xuất ở tab 1 ⇒ tab 2 về `/login?next=%2Faccount` ngay. Đăng nhập lại ở tab 1 ⇒ tab 2 tự khôi phục phiên và quay về `/account`.

### Lighthouse 13.5.0 (build prod, Chrome headless)
LIGHTHOUSE_TABLE

## 4. Quyết định tự đưa ra (cần Tech Lead duyệt)
1. **Mock dev là route handler Next cùng origin, không dùng Service Worker của MSW.** Lý do: cookie refresh HttpOnly hoạt động như thật (SW không đặt được cookie HttpOnly); không cần CORS; không phải nới CSP (`strict-dynamic` chặn đăng ký SW nếu không thêm `worker-src`). Route trả 404 khi tắt cờ hoặc ở `APP_ENV=staging/production` (`isMockApiEnabled`, có test). Đánh đổi: code mock nằm trong image (không chạy được nếu không bật cờ), dữ liệu mất khi restart server.
2. **Lỗi mạng khi đang refresh giữa phiên không kết thúc phiên** (đổi hành vi `http` của T-012): request trả `NETWORK_ERROR`, phiên giữ nguyên. Theo frontend.md §3.3 (lỗi mạng ≠ đẩy về login). Test cũ được sửa cho đúng ý này.
3. **Không refresh chủ động** (hẹn giờ `expiresIn − 60s` ở frontend.md §3.3): ticket ghi "chỉ refresh khi `TOKEN_EXPIRED`", và luồng phản ứng đã trong suốt với người dùng (đã test). Có thể thêm sau khi có socket (T-016 cần token còn hạn cho `auth:renew`).
4. Sau đăng ký vào `/w` (chưa có board của `defaultWorkspaceId` như frontend.md §1.2) — board là ticket sau.
5. `RATE_LIMITED` hiện số giây tĩnh, **chưa có đồng hồ đếm ngược**.
6. Login/register luôn hiện form trong lúc GuestGate đang khôi phục phiên (không chặn bằng spinner): tốt cho LCP/a11y; người đã đăng nhập sẽ thấy form khoảng một nhịp trước khi bị chuyển.

## 5. Rủi ro / câu hỏi mở
1. Dữ liệu mock ở dev dùng chung cho mọi trình duyệt trỏ vào cùng server Next (giữ trong `globalThis`). Chỉ dùng trên máy dev; staging/production bị chặn bằng cờ.
2. Mock **không** kiểm `Origin` cho `/auth/refresh`/`/auth/logout` (server thật trả `403 ORIGIN_NOT_ALLOWED`). FE đã xử lý mã này như mất phiên (có unit test), nhưng luồng này chưa đi qua mock.
3. Tên field trong form = khóa trong body contracts. Nếu C đổi tên field, lỗi `VALIDATION_ERROR` sẽ rơi vào lỗi gốc (không mất, nhưng hiển thị sai chỗ).

## 6. Dependency mới (`apps/web`, pin chính xác, kiểm trên npm registry 2026-10-15, đều ≥ `minimumReleaseAge`)
`@tanstack/react-query` 5.104.2 · `react-hook-form` 7.90.0 · `@hookform/resolvers` 5.9.1 · `msw` 3.0.3 (dependency vì route mock dùng lúc chạy) · dev: `@testing-library/user-event` 14.6.8. Các phiên bản khớp frontend.md §10 (V5, V7, V11).

## 7. Definition of Done
DOD_BLOCK
