# T-072: giao diện trò chuyện (Engineer H, web Mốc 6)

**Trạng thái:** DONE · **Branch:** `feat/T-072` (gộp vào `feat/avatar-chat`, vào `main` 701e337c) · **Ngày:** 2026-10-18 · **Thiết kế:** `docs/design/avatar-chat.md` v2.1 (ADR-141…146, §4, §7 E6–E13) · **Kèm:** G (contract + server T-069/T-070), F (selector E2E, chat-sec), B (soát bảo mật web)

## Đã làm

| Commit | Nội dung |
|---|---|
| bef52820 | `http.upload` refresh chủ động khi access token còn < 60 s (tệp chat ≤ 20 MB trên mạng chậm — TL chốt) |
| 53835c6b, f52c6be8 | ☰ có "Trò chuyện" theo thứ tự TL; ≥ md là icon cạnh chuông (badge `9+`), < md có chấm trên ☰ khi có tin chưa đọc (E9) |
| 3b6f901e, ff225bb8 | mock-api trò chuyện theo contract chat của G (cherry-pick), con trỏ đọc trong `ConversationDto` |
| 59858edd | `entities/chat`: api theo §4, query key `['chat', …]` (xóa sạch khi đăng xuất / SESSION_REVOKED), cache luồng tin thuần (gộp theo `id` / `clientMsgId` của cùng người gửi) |
| 2caee751, 2a6d4faf | `features/chat-realtime`: vá cache theo event, "đang gõ" ≤ 5 s, "Đã xem" (DIRECT), bù `GET …/messages?after=` khi nối lại; `sendTyping` gửi rồi quên |
| d165bc9b, f8d42a97 | Gửi lạc quan (id tạm = `clientMsgId`, "Thử lại" cùng `clientMsgId`, "Bỏ"); ô soạn: Enter bỏ qua `isComposing` (Telex/VNI), cảm ứng ⇒ xuống dòng + nút Gửi, dán / kéo-thả, chip tệp có tiến độ + hủy; typing throttle 3 s |
| 059f3693 | Hiển thị tin: linkify chỉ http(s), đính kèm (ảnh xem trước qua URL ký, tệp ⇒ download-url ⇒ `location.assign`), sửa ≤ 15 phút, xóa, trạng thái gửi lỗi |
| ebc102a7, 682c941e | Luồng: `log "Tin nhắn"`, cuộn ngược giữ chỗ, vạch "Tin chưa đọc", đánh dấu đọc, vùng `aria-live` riêng chỉ đọc tin ĐẾN; "Tin nhắn mới" / "Tạo nhóm"; Tắt tiếng; dialog Thành viên nhóm (đổi tên, thêm, bớt, giao trưởng nhóm, rời) |
| 821e0aa1, bf48bef8 | Trang `/chat`, `/chat/[id]`, `/chat/ws/[wsId]` (tạo-hoặc-lấy phòng ws rồi thay URL); lối vào ở trang chính (< md) và trên trang workspace |
| 6ad1a890 | Luồng trò chuyện trên app thật + mock (vitest, 8 ca → 9 sau L1); input tệp ẩn có nhãn (axe) |
| 7aab08c0 | B L1/L2 (lần 1): URL tệp / ảnh từ server chỉ dùng khi thuộc `/media/<kind>/` của CHÍNH origin API (`isApiMediaUrl`) |
| 64c82b55, 0450778a | Khớp server T-069 (G): direct / groups / phòng ws / đổi tên trả `ConversationDetailDto` (DIRECT `members` đủ người còn ở công ty), PUT phòng ws 201 / 200, download-url ảnh ⇒ 404, lời cho `ATTACHMENT_UNAVAILABLE` và hạn mức 200 MB/ngày |
| 42952946 | Cổng Mốc 6: `upload.test` mã lạ dùng `SOME_FUTURE_CODE`; mock bỏ `failUnlisted` ⇒ `fail` (mã đã có ở T-067) |
| c04df88c | B L1/L2 (lần 2): nối lại bù gặp 404 ⇒ xử lý như `chat:conversation:removed`; removed rời cả `/chat/ws/[wsId]` khi phòng đã phân giải ra hội thoại đó |
| 38773615 | `shared/ui/combobox`: không có option ⇒ ẩn listbox, chữ trống / đang tìm thành `role=status` ngoài listbox (axe `aria-required-children` ở "Tin nhắn mới" — sửa luôn cho mọi nơi dùng combobox); test axe khi mở rỗng |
| af519c7b … c4efc611 | E2E phần H (T-073): E2E-CH-01 (avatar, 360 / 1280, HR gỡ ảnh), E2E-CH-07 (axe sáng/tối 360 / 1280 + aria-live), SEC-CH-13 (XSS hiển thị, cả vế realtime ở /w), SEC-CH-20 web (Sentry không mang `sig`); bỏ fixme khi T-068/069/070 vào |

## Quyết định tự đưa ra

- **Mất quyền ⇒ mất lịch sử ở client**: removed (event) và 404 khi bù sau nối lại đi CHUNG một đường `forget()` — xóa cache tin + chi tiết, rời trang nếu đang xem.
- **`chat:conversation:updated` chỉ invalidate** (không ghi đè bằng DTO trong event): DTO theo góc nhìn từng người (unread / muted / myRole) — tải lại là chắc nhất.
- **Ảnh không có download-url**: dùng `previewUrl` / `thumbUrl` ký sẵn; lỗi tải ảnh ⇒ invalidate MỘT lần để lấy URL ký mới (không lặp).

## Ngoài phạm vi

- Gộp `feat/avatar-chat` × `main` (Mốc 5): H giải 5 file web cho G (menu ☰, danh sách nhân viên có cả hồ sơ M5 lẫn ảnh M6, `employee-dialog` thêm kind `avatar`).

## Còn lại

- **Checklist máy thật** trước deploy: bàn phím Telex / VNI trên Android + iOS (Enter khi đang gõ dấu), dán ảnh từ clipboard trên Safari.
- Rời / xóa mềm workspace server CHƯA phát `chat:conversation:removed` (G) ⇒ web dựa vào 404 REST.

## Kết quả kiểm

| Kiểm | Kết quả |
|---|---|
| Từng bước: `tsc --noEmit`, `eslint`, `prettier`, vitest các file liên quan (2 worker) | sạch mọi bước |
| Cả bộ unit web `vitest run --maxWorkers=2` (@c4efc611) | **106 file, 763 passed**, 105 s |
| `next build` (@c4efc611) | **thành công** (`/chat`, `/chat/[id]`, `/chat/ws/[wsId]`) |
| `apps/api` `test/contract/realtime-event-parity.test.ts` | 22 passed |
| B soát bảo mật web (c04df88c) | **Đạt**, không HIGH; L1/L2 đã đóng |
| E2E toàn bộ với server thật (TL chạy, main 701e337c) | **E2E-CH-01, E2E-CH-07, SEC-CH-13 xanh** — lần đầu E2E-CH-07 đỏ (axe ở combobox, sửa 38773615), E2E-CH-01 đỏ do env E2E thiếu `MEDIA_BASE_URL` (G sửa `e2e/support/api-env.ts`, không phải web) |
| SEC-CH-20 web (Sentry không mang `sig`) | chỉ chạy ở lượt có `E2E_SENTRY_DSN` — chưa có trong lượt này |
