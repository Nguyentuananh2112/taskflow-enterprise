# T-029 — Báo cáo: sửa lỗi bảo mật web (audit T-028)

**Người làm:** Engineer E (session `taskflow-enterprise-54`) · **Branch:** `fix/T-029-web-sec` (từ main `cbde133`) · **Ngày:** 2026-10-15
Yêu cầu: tin nhắn của Tech Lead (chưa có file ticket). T-025 tạm dừng, WIP đã commit `60eb63a` trên `feat/T-025`.

## H1 — Open redirect sau đăng nhập (`shared/lib/safe-next-path.ts`)
- **Nguyên nhân (đã tái hiện):** hàm kiểm `//` trên chuỗi THÔ rồi trả `url.pathname` SAU khi parser chuẩn hóa: `/..//evil.com`, `/.//evil.com`, `/a/..//evil.com`, `/%2e//evil.com` ⇒ pathname `//evil.com` ⇒ GuestGate `router.replace` sang host khác.
- **Sửa:** (1) từ chối chuỗi thô có `\` hoặc bắt đầu `//`; (2) kiểm lại **kết quả sau chuẩn hóa**: cùng origin giả định, không bắt đầu `//` hay `/\`; (3) **whitelist segment đầu**: chỉ `/w…` và `/account…` (route mới cần `?next=` phải thêm có chủ đích).
- **Test:** 35 ca — dot-segment, `%2e`/`%2E%2E`, `%2f`, `%5c`, backslash, path ngoài whitelist (`/login`, `/mock-api/…`, `/`), và ca khẳng định kết quả luôn cùng host khi đưa qua chính URL parser.

## H2 — Đăng xuất không kết thúc phiên ở server
- **(a) `shared/api/http.ts`:** POST/PATCH **luôn** gửi `Content-Type: application/json`; không có body ⇒ gửi `{}`. Khớp `requireJsonContentType` của API (POST/PUT/PATCH bắt buộc JSON kể cả không body). DELETE không body vẫn không gửi Content-Type (API không đòi). Test mới trong `http.test.ts`; khẳng định cũ ở dòng 99 là của **GET** nên giữ nguyên (đúng).
- **(b) `entities/session`:** `logout()` thử lại 1 lần (500ms), phiên local vẫn kết thúc, nhưng trả `false` khi server chưa xác nhận và đặt cờ `logoutPending`. Khi cờ bật: `bootstrap()` **không** tự đăng nhập lại bằng cookie (người dùng đã chọn đăng xuất). UI: toast lỗi ở nút Đăng xuất + khối cảnh báo "Chưa đăng xuất được trên máy chủ — [Thử lại đăng xuất]" trên màn khách (`LogoutPendingAlert` trong GuestGate). Cờ chỉ ở bộ nhớ: tải lại trang thì refresh chạy bình thường — trạng thái hiển thị đúng với server (phiên còn ⇒ đang đăng nhập).
- **(c) Mock MSW khắt khe như server:** handler chặn đầu (`request-guards.ts`) trả **415** cho POST/PUT/PATCH thiếu/sai Content-Type hoặc charset ≠ UTF-8 (như `requireJsonContentType`); `/auth/refresh` + `/auth/logout` trả **403 `ORIGIN_NOT_ALLOWED`** khi thiếu Origin hoặc Origin ngoài whitelist (như `requireAllowedOrigin`). Cookie jar của test gửi `Origin` như trình duyệt. Cookie path `<base>/auth` đã đúng từ T-019.
- **Kiểm chứng test bắt được lỗi:** tạm hoàn nguyên `http.ts` về bản cũ ⇒ `test/auth-flow.test.tsx` đỏ 2/3 ca (đăng xuất, đăng xuất mọi thiết bị); bản sửa ⇒ xanh.

## Medium
- **Form trước hydration:** `shared/ui/client-form` — `<form method="post">` + `<fieldset disabled>` cho tới khi React chạy ở client ⇒ không thể kích hoạt submit gốc (mặc định GET, đưa mật khẩu lên URL). Áp dụng cho login, register, đổi mật khẩu, hồ sơ. Test: HTML server render có `method="post"` và `fieldset disabled`; ở client mở khóa và gọi handler JS.
- **APP_ENV mặc định = production:** `server-env.ts` (không đặt ⇒ production: HSTS, `upgrade-insecure-requests`); mock API chỉ bật khi `APP_ENV` **đặt tường minh** `local|test`. `.env.example` ghi rõ phải đặt `APP_ENV=local` ở dev; CI đã đặt `APP_ENV=test` (`ci.yml:303`).

## Quyết định tự đưa ra (cần Tech Lead duyệt)
1. Whitelist `?next=` theo segment đầu `w`, `account`.
2. Logout lỗi: retry 1 lần trong `logout()`; không chặn người dùng ở lại trạng thái đăng nhập (theo yêu cầu "vẫn xóa state local").
3. `ClientForm` áp cả cho form hồ sơ (không có mật khẩu) để đồng nhất.

## Rủi ro / ghi chú
- Dev chạy `next dev` mà quên `APP_ENV=local` ⇒ CSP có `upgrade-insecure-requests` ⇒ request http tới API local bị nâng https và hỏng — chủ đích (an toàn mặc định), đã ghi trong `.env.example`.
- Ngoài phạm vi: `apps/api/src/core/http/middleware.ts` trên main còn regex charset mất escape (`charsets*=s*`) — A đã sửa trên `feat/T-024` (`6fe97c9`), cần merge.

## Definition of Done (worktree `D:/TaskFlow_wt/T-025`, branch `fix/T-029-web-sec`)
```
$ pnpm typecheck              → exit 0
$ pnpm lint                   → exit 0 (prettier, eslint --max-warnings=0, depcruise api + web 0 vi phạm)
$ pnpm test --maxWorkers=2    → Test Files 110 passed (110) · Tests 1180 passed (1180) · exit 0, không có Unhandled Error
```
