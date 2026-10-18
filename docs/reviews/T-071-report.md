# T-071: giao diện ảnh đại diện (Engineer H, web Mốc 6)

**Branch:** `feat/T-071` từ `feat/avatar-chat` @389429a · **Ngày:** 2026-10-18 · **Thiết kế:** `docs/design/avatar-chat.md` v2.1 (ADR-141/142, §7 E1–E5, E12, E13) · **Kèm:** E (web), G (contract), F (selector E2E)

## Đã làm

| Commit | Nội dung |
|---|---|
| f9e13e2 | `shared/api/upload.ts`: transport XHR (octet-stream, `X-Upload-Name` = `encodeURIComponent`, `withCredentials=false`, tiến độ 0..1, hủy ⇒ AbortError, lỗi mạng/timeout ⇒ NETWORK_ERROR). `http.ts`: tách `authed()`, là chính sách xác thực **duy nhất** cho request / download / upload (TOKEN_EXPIRED ⇒ refresh + gửi lại 1 lần cùng Blob, tiến độ báo lại từ 0; SESSION_REVOKED ⇒ revoked; hủy không kết thúc phiên; upload chờ refresh đang chạy). Fetch vẫn chỉ gửi JSON: chỉ có một đường nhị phân (góp ý E). `envelope.ts`: parse envelope + readFile chuyển **nguyên văn** từ http.ts (max-lines). Contract tạm `pending-contracts/avatar.ts` |
| e3ee2bc | `shared/ui/avatar`: prop `src` ⇒ `<img>` kích thước cố định, `decoding=async`, `loading` chỉ khi truyền, `referrerPolicy=no-referrer` (R43). Lỗi tải ⇒ chữ cái; nhớ URL đã lỗi nên `src` mới tự thử lại, không setState trong effect. `size="lg"`. API cũ giữ nguyên |
| f9dbe6c | mock-api: `PUT/DELETE me/avatar`, `DELETE hr/employees/:userId/avatar`, `GET media/avatars/:userId/:variant` (URL ký giả khung 24 giờ, kiểm version + hạn mỗi lần, lỗi ⇒ HTML tối giản sandbox). `contentTypeGuard` có ngoại lệ octet-stream **đúng cặp method + path** (B M1). `/auth/me`, login, PATCH me trả `avatarUrl` / `avatarUrlLarge`. `failUnlisted` cho mã chưa có trong ErrorCode |
| 276bb91 | `features/avatar-upload`: toán cắt thuần (`crop.ts`), giải mã `createImageBitmap(from-image)` thu về cạnh 2048, canvas nền trắng, xuất JPEG 512 q0.85. Khung cắt canvas có Pointer Events + phím ←↑→↓ (Shift ×5) / `+` `-` + slider "Thu phóng" (WCAG 2.5.7). Dialog "Cắt ảnh đại diện" có tiến độ, Hủy ⇒ hủy upload. `/account` thêm mục `region "Ảnh đại diện"`; header có ảnh. `entities/session` parse bằng schema có avatar (zod bỏ khóa lạ) |
| 6866883 | CSP `img-src` thêm origin API (E3). Sentry che `[?&]sig=` trong chuỗi tự do (F-11). Lỗi 422 `BUSINESS_RULE_VIOLATION` theo `details.rule` `IMAGE_UNREADABLE` / `IMAGE_TOO_COMPLEX` (G/TL chốt) |
| 3d9f726 | Realtime `user:avatar-changed` ⇒ làm mới mọi query hiện avatar (me, thông báo, ws members/board/audit). Event của chính mình ⇒ fetch `/auth/me` rồi `session.updateUser` (header đọc từ phiên) |
| b605be4 | `/hr/employees`: nút `Gỡ ảnh đại diện <tên>` + dialog **cấp trang** (E12), quyền theo SEC-CH-17 (không tự gỡ; người giữ grant chỉ Admin gỡ) |
| 31fbc4c1, e6f891e9 | Cherry-pick contract của G (7bed90e7, f5c94890 — chỉ `packages/contracts` + test parity; TL bảo) |
| 707f1590 | Bỏ `pending-contracts/avatar.ts`, dùng contract thật (UserDto/UserRefDto/AvatarUploadResponseDto, `user:avatar-changed` trong ServerToClientEvents). Thẻ task có ảnh (lazy). Nút "Gỡ" chỉ khi `EmployeeDto.avatarUrl` (TL chốt). Mock TaskDto/EmployeeDto mang URL hiện tại; mock **không** phát `user:avatar-changed` (parity (c)) |
| 7b6bb7c8 | Trang thành viên ws + ứng viên có ảnh (`MemberDto.avatarUrl`) |

## Quyết định tự đưa ra

- **Trần ảnh gốc 20 MB phía web** (chưa giải mã): chặn giải mã ảnh quá lớn trên máy yếu. Ảnh gửi lên là bản 512 px đã cắt, luôn dưới trần 5 MB của server.
- **Canvas cho khung xem trước** (không dùng `<img>` + `style` transform): cùng hàm vẽ với ảnh xuất nên thấy gì lưu nấy, và không vướng CSP `style-src` (W-CSP-2).
- **Mũi tên = hướng nhìn**: "←" đưa phần bên trái ảnh vào khung. Ảnh vuông ở zoom 1 không dịch được (đã báo F cho E2E-CH-01).
- **XHR giả qua fetch trong test UI** (`test/fetch-xhr.ts`): jsdom kiểm CORS cho XHR mà mock MSW không mô phỏng CORS/preflight. Ngữ nghĩa XHR thật có `upload.test.ts`.

## Ngoài phạm vi (TL đã duyệt 18/10)

- `packages/config/eslint`: ngoại lệ `XMLHttpRequest` **chỉ** cho `src/shared/api/upload.ts`.
- `shared/api/envelope.ts` tách nguyên văn từ `http.ts`.

## Còn lại

- **ErrorCode mới + BusinessRule IMAGE_*** nằm ở các commit T-067 khác (cccdbe8, 6c70353, 346716f), chưa trên nhánh này ⇒ mock dùng `failUnlisted` (envelope không parse enum); web hiển thị đúng cả khi mã chưa có trong enum (`serverCode`). Gộp T-067 ⇒ đổi `failUnlisted` sang `fail`.
- **E2E-CH-01** (T-073, phần của H) — selector đã khớp với F (test-spec-chat @18a76250).
- **Checklist máy thật** trước deploy (§6): HEIC/ảnh iPhone + Android khi chọn avatar.

## Rủi ro

- Token hết hạn giữa lúc upload ⇒ server trả 401 sau khi nhận đủ body ⇒ upload 2 lần. Avatar ~100 KB nên chấp nhận. Tệp chat 20 MB (T-072): refresh chủ động khi access token còn < 60 s, tính từ `expiresIn` (TL chốt).
- API thật phải có `X-Upload-Name` trong CORS `allowedHeaders` (G), nếu thiếu thì upload trên trình duyệt hỏng ở preflight. Test web không bắt được lỗi này (mock không có CORS).

## Kết quả kiểm (snapshot feat/T-071 @7b6bb7c8, lượt máy TL cấp sau cổng m5)

| Kiểm | Kết quả |
|---|---|
| Từng bước: `tsc --noEmit`, `eslint`, `lint:deps`, vitest các file liên quan (2 worker) | exit 0 mọi bước |
| Cả bộ unit web `vitest run --maxWorkers=2` | **exit 0 — 99 file, 721 passed**, 136 s, không Unhandled Error |
| `next build` (`pnpm run build`) | **exit 0** |
| `apps/api` `test/contract/realtime-event-parity.test.ts` | exit 0 — 16 passed |

Ca mới: `upload.test.ts` 12 · `avatar.test.tsx` +6 · `avatar-api.test.ts` 9 · `crop.test.ts` 9 · `errors.test.ts` 3 · `avatar-account.test.tsx` 7 · `avatar-hr.test.tsx` 4 · `avatar-board.test.tsx` 2 · `csp.test.ts` / `sentry.test.ts` cập nhật.
