# Mốc 6 — Avatar và Trò chuyện (thiết kế, CHỜ người dùng duyệt)

> Trạng thái: **v1 draft — chờ phản biện B (bảo mật/lưu file), F (test), G/H (khả thi) rồi người dùng duyệt** (Tech Lead, 2026-10-17). ADR-141…148 chỉ vào `DECISIONS.md` sau khi duyệt; rủi ro R43–R48 vào `threat-model.md` §6 (B, T-074). Vé T-067…T-074. Chưa ai code trước khi duyệt.
> Căn cứ: `company-level.md` v2.1 (ADR-133…140), `data-retention.md` (R27), `threat-model.md` (tới R42), `security.md` §5–6, `devops.md` §1/§4.3, runbook `backup-restore.md`, `schema.prisma` @0dcaaf4 (migration 5), `core/realtime/*` (phòng `user:` / `session:` / `project:`, `companyGatedSocketAuthenticator`), `core/http/middleware.ts` (`requireJsonContentType`, body 100 kB), `IWorkspaceExitPort`, web `shared/ui/avatar`, `app/security/csp.ts`. Dữ liệu ví dụ là bịa.
> **Chạy song song Mốc 4/5** bằng đội riêng: **G** (backend), **H** (web), **F** (test), B review. Không đụng module `payroll`, `leave`, `attendance`, `hr`, `company` (trừ chỗ ghi rõ ở §9).

## 0. Quyết định

| Quyết định | Nguồn | ADR |
|---|---|---|
| Mỗi người tự tải ảnh đại diện (cắt vuông, giới hạn dung lượng); không ảnh ⇒ chữ cái như hiện nay | Người dùng 17/10 | ADR-142 |
| File lưu trên **ổ đĩa máy chủ của công ty** (volume), **không** dịch vụ cloud trả phí | Người dùng 17/10 | ADR-141 |
| Ba loại hội thoại: **1-1**, **nhóm tự tạo** (chọn người từ danh bạ công ty), **phòng của mỗi workspace** (thành viên theo membership ws). **Không** kênh toàn công ty | Người dùng 17/10 | ADR-143 |
| Gửi ảnh và file ngay từ v1 | Người dùng 17/10 | ADR-141, ADR-145 |
| Admin/HR gỡ được avatar không phù hợp (có audit) | **TL đề xuất** | ADR-142 |
| Admin/HR **không** đọc được trò chuyện của người khác | TL (quyền riêng tư) | ADR-146 |
| Phòng workspace: thành viên **tính lúc đọc** từ `workspace_members`, không đồng bộ bảng | TL | ADR-143 |
| Realtime phát tới phòng `user:{id}` của từng người nhận (không phòng theo hội thoại) | TL | ADR-145 |
| Không thông báo chuông / email / push cho chat ở v1 — chỉ badge chưa đọc riêng | TL | ADR-145 |
| Tải lên là body nhị phân `application/octet-stream` (không multipart) | TL | ADR-141 |
| Ảnh/file phục vụ qua **URL ký HMAC có hạn** từ API, không URL công khai | TL | ADR-141 |
| Không quét virus ở v1 (port sẵn, ClamAV tùy chọn) — **hỏi người dùng** | TL | ADR-141, R45 |
| Thời hạn lưu tin nhắn/file — **hỏi người dùng** (đề xuất 24 tháng) | TL | ADR-147 |

## 1. Phạm vi

**Có:** avatar (tải, cắt, gỡ, hiển thị mọi nơi đang có chữ cái); 1-1, nhóm, phòng ws; văn bản ≤ 4 000 ký tự, trả lời (reply), sửa ≤ 15 phút, xóa của chính mình; ảnh + file đính kèm; chưa đọc / đã đọc; đang gõ; tắt tiếng; realtime + bù khi nối lại; retention.
**Không (v1):** kênh toàn công ty, tìm kiếm nội dung tin nhắn, reaction, ghim, chuyển tiếp, gọi thoại/video, xuất lịch sử, báo cáo vi phạm, email/push, mã hóa đầu-cuối, video/âm thanh đính kèm, file nén.

## 2. ADR đề xuất

**ADR-141 — Kho file: port `IFileStore` + adapter ổ đĩa cục bộ; URL ký; ảnh mã hóa lại.**
- **Port** `core/files/ports.ts` (core không import module — ADR-016): `put(stream, {maxBytes}) → {key, sizeBytes, sha256}` · `open(key) → Readable` · `delete(key)` · `exists(key)`. Adapter `LocalFileStore` (`core/files/local-file-store.ts`); thay adapter S3/MinIO sau này không đổi use case.
- **Đường dẫn:** `FILE_STORE_DIR` (env, tuyệt đối, bắt buộc khi bật Mốc 6; ngoài thư mục app/web root). Khởi động: không tồn tại / không ghi được ⇒ từ chối khởi động (như env khác — `devops.md` §2.4). Docker: volume `filestore:/var/lib/taskflow/files`, chủ `node`. **Khóa trên đĩa do server sinh**: 128 bit ngẫu nhiên base32, chia thư mục `ab/cd/<key>`; **không** dùng tên người dùng, **không** content-addressed (dedupe làm khó xóa theo retention và lộ "file này đã tồn tại"). Ghi `tmp/<key>` → `fsync` → `rename` nguyên tử; lỗi giữa chừng ⇒ xóa tmp. Kiểm `key` bằng regex trước mọi thao tác đĩa (chống path traversal kể cả khi DB bị sửa).
- **Tải lên = body nhị phân**, `Content-Type: application/octet-stream` (bắt buộc — không thuộc nhóm "CORS-safelisted" ⇒ trình duyệt vẫn preflight, giữ lớp chống CSRF của `requireJsonContentType`), tên gốc trong header `X-Upload-Name` (percent-encoded UTF-8, ≤ 255 byte sau giải mã; không đặt ở query để không vào access log). Middleware `rawUpload({maxBytes})` thay `jsonBody` cho đúng route upload: `Content-Length` > trần ⇒ 413 ngay; chunked ⇒ đếm theo luồng, vượt ⇒ hủy + 413; hash SHA-256 khi ghi. **Không thêm busboy/multer** (không có trong deps; multipart không cần vì mỗi request một file). `X-Upload-Name` thêm vào CORS `allowedHeaders` + pino redact.
- **Loại file bằng magic bytes**, không tin đuôi / `Content-Type`: hàm thuần `sniffType(head, extHint)` (đọc 4 KB đầu). Danh sách cho phép:
  - ảnh: JPEG, PNG, WebP, GIF (tĩnh — chỉ lấy khung đầu) — **không** SVG, HEIC (iOS tự đổi sang JPEG khi `accept="image/jpeg,image/png,image/webp"` — chưa kiểm chứng, H thử máy thật);
  - file: PDF (`%PDF-`), DOCX/XLSX/PPTX (ZIP + `[Content_Types].xml` ở entry đầu), ODT/ODS, TXT/CSV (UTF-8 hợp lệ, không byte NUL trong 8 KB đầu).
  - Cấm: HTML, SVG, XML, JS, file chạy được, macro (`.docm`, `.xlsm`…), file nén (ZIP/RAR/7z thuần), video/âm thanh. Đuôi và magic không khớp ⇒ 415 `UNSUPPORTED_FILE_TYPE`.
- **Ảnh mã hóa lại phía server** bằng **sharp** (Apache-2.0; libvips LGPL-3.0 liên kết động — dùng nội bộ được): bản 0.35.5 **đã có trong lockfile** (phụ thuộc của `next`) ⇒ thêm vào `apps/api` cùng bản, không tải thêm; prebuilt cho linux-x64 glibc (`bookworm-slim` của image API) và win32-x64 (máy dev). A/B kiểm phiên bản + giấy phép trên npm trước khi thêm (TEAM luật 4). Cấu hình: `limitInputPixels` 40 MP (chống pixel bomb), `sharp.concurrency(1)` + hàng đợi tối đa 2 phép biến đổi đồng thời, timeout 10 s; `.rotate()` theo EXIF rồi **bỏ toàn bộ metadata** (EXIF/GPS/ICC trừ sRGB); xuất WebP q≈82.
  - avatar: 256 px và 64 px; ảnh chat: `preview` cạnh dài ≤ 1 600 px + `thumb` ≤ 320 px; **không giữ bản gốc** của ảnh gửi dạng "ảnh" (bản gốc có GPS). Muốn gửi nguyên bản ⇒ chọn "Gửi dạng file" (lưu nguyên, chỉ tải xuống; UI cảnh báo "file giữ nguyên thông tin vị trí trong ảnh").
  - **Dự phòng** khi sharp không nạp được (kiến trúc lạ, thiếu binary): app vẫn chạy, log `files.image_pipeline_unavailable` + cảnh báo; avatar trả 503 `IMAGE_PROCESSING_UNAVAILABLE`; ảnh chat chỉ gửi được "dạng file". Không dùng thư viện JS thuần thay thế (chậm, tốn RAM, ít người bảo trì).
- **Phục vụ file** — mọi file qua API, **không** URL công khai, **không** thư mục static:
  - `GET /api/v1/media/<loại>/<id>/<biến thể>?exp=<unix>&sig=<hmac>`; `sig = HMAC-SHA256(FILE_URL_SECRET, path|exp)` base64url, so sánh constant-time; hết hạn / sai ⇒ 404 (không phân biệt). Lý do: `<img>` không gửi được header `Authorization` (Bearer, API khác origin — `devops.md` §2.2); cookie phiên cho media phải sửa luồng auth. URL ký chỉ được phát cho **người đã xác thực có quyền** ở response REST.
  - `exp` làm tròn theo **khung**: avatar khung 24 giờ (URL hiệu lực 24–48 giờ), ảnh chat khung 1 giờ (1–2 giờ) ⇒ URL ổn định trong khung, trình duyệt cache được. File không phải ảnh: **không** ký sẵn — `POST /chat/attachments/:id/download-url` kiểm quyền lúc bấm, trả URL hạn **60 giây**.
  - Header: `X-Content-Type-Options: nosniff` · `Content-Security-Policy: default-src 'none'; sandbox` · `Cross-Origin-Resource-Policy: same-site` · `Referrer-Policy: no-referrer` · ảnh do ta mã hóa lại: `Content-Type: image/webp`, `inline`, `Cache-Control: private, max-age=86400, immutable` + `ETag`; file khác: `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<ascii an toàn>"; filename*=UTF-8''<tên đã làm sạch>`, `Cache-Control: private, no-store`. Không hỗ trợ Range (không có video).
  - pino-http redact `sig` ở query `/media`. Web CSP `img-src` thêm origin API (`csp.ts`, `security.md` W-CSP-2).
- **Hạn mức:** avatar đầu vào ≤ **5 MB**; file chat ≤ **20 MB**, ≤ 10 đính kèm / tin; mỗi người ≤ 200 MB tải lên / ngày và ≤ 30 lượt tải / 10 phút; tổng kho `FILE_STORE_MAX_BYTES` (mặc định 50 GB) — vượt ⇒ 507 `STORAGE_FULL` + cảnh báo; ổ còn < 10 % ⇒ cảnh báo (metrics `files_store_bytes`, `files_disk_free_ratio`).
- **Quét virus:** port `IMalwareScanner` (mặc định `Noop`), adapter `clamd` (container `clamav/clamav`, miễn phí, ~1–1,5 GB RAM cho chữ ký) **chỉ khi người dùng chọn** (Q4). Không quét: bù bằng danh sách cho phép hẹp, luôn `attachment`, `nosniff`, ảnh mã hóa lại — rủi ro còn lại R45.
- **Dọn rác:** job `files-sweep` (mẫu T-033: mỗi giờ + jitter, advisory lock riêng, theo lô, idempotent): xóa upload chưa gắn tin > 24 giờ; xóa blob mà DB không còn tham chiếu (đánh dấu trước, xóa sau 24 giờ — tránh đua với upload đang ghi); tmp > 1 giờ. Xóa trong DB **trước**, xóa đĩa **sau commit**; xóa đĩa lỗi ⇒ lượt sau dọn.
- **Một instance** (v1, như `devops.md` §7.1): ổ cục bộ không chia sẻ giữa instance. Lên ≥ 2 instance ⇒ volume chung (NFS) hoặc adapter MinIO tự host (R47).

**ADR-142 — Avatar.**
- `users.avatar_version INT NULL` (cột duy nhất thêm vào `users`); blob `avatars/<userId>/<version>/{256,64}` qua `IFileStore` (khóa do server sinh từ uuid + số — không có phần nào do người dùng nhập).
- `PUT /api/v1/me/avatar` (octet-stream ≤ 5 MB, ảnh) ⇒ sniff → sharp (cắt vuông giữa nếu client chưa cắt) → ghi 2 biến thể → transaction `avatar_version = coalesce(+1, 1)` → sau commit xóa version cũ. Response `{avatarUrl}`. `DELETE /api/v1/me/avatar` ⇒ `NULL`. Hạn mức 10 lần / giờ / user.
- **Gỡ avatar người khác (TL đề xuất):** `DELETE /api/v1/hr/employees/:userId/avatar` — `hr:manage` (HR + Admin); avatar của Admin hoặc người giữ grant chỉ Admin gỡ (giống luật ADR-137); không tự gỡ qua route này (dùng `/me`). Audit `hr_audit_logs` action `AVATAR_REMOVED` (chỉ thêm giá trị vào tập action ở contracts, qua port audit sẵn có — không sửa module HR). Người bị gỡ nhận event `user:avatar-changed`.
- **Ai thấy:** chỉ người đang thuộc công ty (URL chỉ có trong response cho người đã xác thực qua cổng công ty).
- **DTO:** `UserRefDto` thêm `avatarUrl: string | null` **tùy chọn** (`.optional()`) ⇒ module chưa cập nhật vẫn hợp lệ, web rơi về chữ cái. Cập nhật ở Mốc 6: `/auth/me`, task (`assignee`, `createdBy`), thành viên ws + `member-candidates`, audit task, thông báo (`actor`), chat (mọi nơi). **Để nguyên** DTO của attendance/leave/hr/payroll (đội Mốc 4/5 thêm khi rảnh, chỉ cần select `avatarVersion` + gọi `avatarUrlOf`). Hàm chung `avatarUrlOf(userId, version, size)` ở `core/files` (ký URL, khung 24 giờ).
- **Người đã nghỉ việc:** không có dòng `company_members` ⇒ `avatarUrl = null` (lịch sử hiện chữ cái + tên); job `files-sweep` xóa blob avatar của người đã rời > 30 ngày (nhận lại trong 30 ngày còn giữ). Lý do: ảnh chân dung là dữ liệu cá nhân (NĐ 13/2023) — không giữ khi hết mục đích; không cần hook vào hoàn tất nghỉ việc.
- **Web:** `shared/ui/avatar` thêm prop `src?: string | null` (`<img>` `loading="lazy"`, `decoding="async"`, `alt=""` khi decorative; lỗi tải ⇒ rơi về chữ cái); cắt ảnh tự viết bằng canvas (kéo + thanh zoom, 360 px trước, không thêm dependency), client thu về 512 px JPEG trước khi gửi (đỡ băng thông 4G) — server vẫn mã hóa lại.

**ADR-143 — Mô hình hội thoại.**
- `chat_conversations.kind ∈ {DIRECT, GROUP, WORKSPACE}`.
- **DIRECT:** `direct_key = "<uuid nhỏ>:<uuid lớn>"` UNIQUE ⇒ một hội thoại cho mỗi cặp; `POST /chat/direct {userId}` = tạo-hoặc-lấy (`INSERT … ON CONFLICT (direct_key) DO NOTHING` rồi đọc). Tự nhắn chính mình ⇒ 422 `SELF_DIRECT`. Người kia đã nghỉ ⇒ đọc được lịch sử, gửi ⇒ 422 `RECIPIENT_INACTIVE`; nhận lại ⇒ dùng lại cùng hội thoại.
- **GROUP:** ai thuộc công ty cũng tạo được (tên 1–80 ký tự, 2–99 người khác, chọn từ `GET /chat/people?q=`); người tạo `OWNER`. OWNER: thêm/bớt người, đổi tên, giao OWNER; thành viên: rời nhóm. Rời / bị bớt ⇒ `left_at` (giữ lịch sử ai từng ở), **mất quyền đọc cả lịch sử** (nhóm tiếp tục riêng tư); thêm lại ⇒ thấy toàn bộ lịch sử (đơn giản, như các app phổ biến — ghi vào thông báo UI khi thêm). Không còn OWNER đang hoạt động (OWNER rời / nghỉ việc) ⇒ hàm thuần `effectiveGroupOwners` coi người tham gia **sớm nhất** còn hoạt động là OWNER (không cần hook vào nghỉ việc); khi người đó thực hiện thao tác OWNER đầu tiên thì ghi `role = OWNER`.
- **WORKSPACE:** `workspace_id` UNIQUE, FK `Cascade` (purge ws xóa luôn chat — khớp R20); tạo **lười** lần đầu mở (`PUT /chat/workspaces/:wsId/conversation` idempotent), không hook vào tạo ws. **Thành viên = `workspace_members` hiện tại của ws chưa xóa mềm / chưa lưu trữ, còn thuộc công ty** — tính lúc đọc / lúc gửi, **không** bảng participant. Lý do: không sửa use case thêm/bớt/rời/purge của workspace (file đội khác), không lệch đồng bộ; bị bớt khỏi ws ⇒ mất quyền ngay ở request kế tiếp và không nhận event kế tiếp. Chi phí: mỗi lần gửi đọc danh sách thành viên ws (index `(workspace_id, user_id)` sẵn có) — chấp nhận. Người mới vào ws thấy toàn bộ lịch sử phòng (như board dự án).
- **Đọc thành viên ws:** port `IWorkspaceChatAccess` (`isMember`, `memberIds`); adapter Prisma chỉ đọc. Nếu dependency-cruiser buộc adapter nằm trong module workspace thì thêm **một file mới** ở `workspace/application/adapters/`, không sửa file cũ.
- **Danh bạ** `GET /chat/people?q=` — mọi người thuộc công ty, trạng thái `ACTIVE`/`OFFBOARDING` (không chờ kích hoạt, không đã rời); trả `id, fullName, avatarUrl` (**không** email — khác R41); `q` 1–100 ký tự, limit 20, 60 / phút / user.

**ADR-144 — Tin nhắn.**
- Thân: chuỗi NFC, trim, 1–4 000 code point (rỗng được nếu có đính kèm); **văn bản thuần**, không Markdown/HTML.
- `clientMsgId` (uuid, client sinh) bắt buộc; UNIQUE `(sender_id, client_msg_id)` ⇒ gửi lại (bấm 2 lần, nối lại) trả **cùng** tin 200 thay vì 201, không phát event lần hai.
- Thứ tự: `(created_at, id)` (id uuid v7, `created_at` giờ thật của server — **không** dùng `TEST_CLOCK_ANCHOR`, như auth/socket — R31). Phân trang keyset: `GET …/messages?before=<id>&limit=50` (cuộn lên) và `?after=<id>&limit=200` (bù khi nối lại; còn nữa ⇒ `hasMore`, web tải lại trang mới nhất).
- `replyToId` phải cùng hội thoại (khác ⇒ 422 `REPLY_OTHER_CONVERSATION`); tin gốc bị xóa ⇒ hiện "Tin nhắn đã bị xóa".
- **Sửa:** người gửi, ≤ 15 phút, chỉ thân chữ ⇒ `edited_at`. **Xóa:** người gửi, bất cứ lúc nào ⇒ `deleted_at`, `body = NULL` ngay, đính kèm tách khỏi tin (blob bị `files-sweep` xóa) — dòng tin còn để giữ chuỗi reply. Không ai khác xóa được tin của người khác ở v1 (Q2).
- Đính kèm: gửi trước `POST /chat/uploads` (octet-stream, `X-Upload-Name`, `?as=image|file`) ⇒ `{uploadId, kind, name, sizeBytes, width?, height?}`; rồi `POST …/messages {clientMsgId, body?, replyToId?, attachmentIds[]}` — mỗi id phải là upload **của chính người gửi**, chưa gắn tin (khác ⇒ 404). Tách 2 bước để có thanh tiến trình và gửi lại không tải lại file.
- Tên file: hàm thuần `sanitizeFileName` — NFC, bỏ ký tự điều khiển / `/\:*?"<>|` / bidi override (U+202A…202E, U+2066…2069), gộp khoảng trắng, cắt 255 byte giữ đuôi, rỗng ⇒ `tep`; chỉ dùng để hiển thị và `filename*`, **không bao giờ** làm tên trên đĩa.
- Hạn mức: gửi 30 / phút + 600 / giờ / user; tạo nhóm 20 / ngày; sửa 30 / phút.

**ADR-145 — Realtime và chưa đọc.**
- **Phát tới `user:{id}`** của từng người nhận (`io.to([...])` một lần, redis-adapter phát một lần): người nhận = participant chưa rời (DIRECT/GROUP) hoặc thành viên ws (WORKSPACE), **lọc còn thuộc công ty** (`access_until > now`) ngay trong truy vấn. Không có `chat:join`, không phòng theo hội thoại. Lý do: danh sách hội thoại cần cập nhật cả hội thoại không mở; phòng `user:` đã gồm mọi tab/thiết bị; quyền tính lúc phát ⇒ không cần cơ chế thu hồi phòng (TOCTOU của `project:join`); người hết `access_until` không nhận tin chat ngay cả trong khe R40.
- Event (vỏ `RealtimeEnvelope` sẵn có, sau commit): `chat:message:new` (tin đầy đủ), `chat:message:updated` (sửa / xóa), `chat:read {conversationId, userId, messageId}` (tới các thiết bị khác của chính mình; DIRECT: cả người kia để hiện "Đã xem"), `chat:conversation:updated` (tên, thành viên, OWNER), `chat:conversation:removed` (bị bớt khỏi nhóm), `chat:typing` (tạm thời), `user:avatar-changed`.
- **Đang gõ:** client → server `chat:typing {conversationId}`, tối đa 1 / 3 s / socket; server kiểm quyền (cache theo socket 30 s), phát cho người khác; không lưu.
- **Bù khi nối lại:** client `GET /chat/conversations` (danh sách + chưa đọc + tin cuối) và với hội thoại đang mở `GET …/messages?after=<id cuối đã thấy>`; khử trùng theo `id`.
- **Chưa đọc:** `chat_read_states(conversation_id, user_id, last_read_message_id, muted)` (cả 3 loại; dòng tạo lười). `PUT …/read {messageId}` chỉ tiến (con trỏ cũ hơn ⇒ bỏ qua, 204). Số chưa đọc = tin sau con trỏ, không phải của mình, chưa xóa, **trần 99** (`LIMIT 100` trong subquery). Tổng ở header bỏ hội thoại tắt tiếng.
- **Không** tạo `notifications` cho chat (không sửa enum `NotificationType` / module notifications mà Mốc 4/5 cũng thêm loại); không email/push ở v1. Người offline thấy badge khi mở app.

**ADR-146 — Quyền và quyền riêng tư.**
- Router `/api/v1/chat/*`, `/me/avatar`, `/media/*` (trừ `/media` dùng chữ ký): cổng công ty `loadCompanyMember` (ADR-135) — chưa thuộc công ty / hết `access_until` ⇒ 401 `SESSION_REVOKED`. Thứ tự lỗi như ADR-135: 401 → 403 → 400 → **404 khi không phải người tham gia** (không lộ tồn tại hội thoại / tin / file) → 422/409.
- **Admin và HR không có quyền ngầm** đọc, liệt kê, xuất hay xóa trò chuyện của người khác — kể cả phòng ws mình không là thành viên (khớp ADR-134). Không có route quản trị chat. Ghi rõ trong thông báo xử lý dữ liệu: tin nhắn **không** mã hóa đầu-cuối; người vận hành có quyền DB / bản sao lưu về kỹ thuật đọc được (R46).
- Nghỉ việc: hoàn tất (ADR-137) đã xóa `company_members` + rời mọi ws + thu hồi phiên ⇒ mất mọi quyền chat, không nhận event; **tin cũ còn**, tên giữ, avatar về chữ cái. Không sửa use case hoàn tất.
- Rời ws ⇒ mất phòng ws ngay (ADR-143). Bị bớt khỏi nhóm ⇒ `chat:conversation:removed`, mất lịch sử nhóm.
- XSS: thân tin render bằng text node; tự nhận link **chỉ** `http(s)://` bằng tách chuỗi (không `dangerouslySetInnerHTML`), `<a rel="noopener noreferrer nofollow" target="_blank">`; tên file, tên nhóm, tên người là text. SVG/HTML không bao giờ được nhận nên không bao giờ phục vụ.

**ADR-147 — Lưu giữ (R27, NĐ 13/2023).**
- Dữ liệu mới: D12 tin nhắn + file chat (cá nhân; có thể chứa dữ liệu nhạy cảm do người dùng tự gõ / gửi), D13 avatar (ảnh chân dung — cá nhân), D14 metadata file (tên gốc, kích thước).
- **Đề xuất (Q1):** tin nhắn + đính kèm **24 tháng** kể từ `created_at` (`CHAT_RETENTION_DAYS=730`, khớp D2 phương án B); tin đã xóa: thân NULL ngay, blob xóa trong ≤ 1 giờ; avatar: xóa khi chủ tự xóa / bị gỡ / rời công ty + 30 ngày; upload mồ côi 24 giờ. Job `chat-retention` hằng ngày theo mẫu `data-retention.md` §4 (lô 1 000, advisory lock riêng, không log nội dung). Purge ws (30 ngày, R20) cascade phòng ws.
- Bản sao lưu file giữ tới hết tầng giữ của backup ⇒ dữ liệu đã xóa còn trong backup tối đa bằng thời hạn backup (như DB — ghi vào thông báo).
- Thông báo xử lý dữ liệu (`data-retention.md` §5) thêm đoạn "Trò chuyện & ảnh đại diện" (B soạn, T-074). Xuất lịch sử: không ở v1.

**ADR-148 — Migration, phân đội, quy tắc song song.**
- Một migration `avatar_chat`: enum `ChatConversationKind`, `ChatParticipantRole`, `ChatAttachmentKind`; 5 bảng mới (§3); `users.avatar_version`. **Không** đụng bảng/enum khác. **Timestamp thư mục migration đặt lúc merge** (như `company-level.md` §8.6); "migration 6…9" trong tài liệu Mốc 4/5 là nhãn, **không** là thứ tự — Mốc 6 không phụ thuộc chúng, chúng không phụ thuộc Mốc 6.
- Code mới nằm trong module mới `apps/api/src/modules/chat`, `core/files`; web `entities/chat`, `features/chat-*`, `features/avatar-*`, `widgets/chat-*`, `views/chat`. File chung buộc phải sửa (ít dòng, TL gộp khi merge): `schema.prisma` (khối "Mốc 6" cuối file + 3 dòng relation ở `User`), composition root, `app.ts` (mount router), `core/http/middleware.ts` (CORS header), `core/realtime/events.ts` (event chat + `chat:typing`), `packages/contracts` (`auth.schemas.ts` `UserRefDto`, thư mục `chat/` mới), web `app-header`, `csp.ts`, `shared/ui/avatar`, `security.md` W-CSP-2.
- Nhánh tích hợp `feat/avatar-chat` từ `main` (mẫu `feat/company-level`): T-067…T-073 merge vào đó; verify gộp một lượt; vào `main` một lần. Rebase lên `main` khi Mốc 4/5 merge.

## 3. Dữ liệu — migration `avatar_chat`

```
users                + avatar_version INT NULL                        -- CHECK (avatar_version IS NULL OR avatar_version > 0)
chat_conversations   id uuid PK · kind · title varchar(80) NULL · direct_key varchar(73) NULL UNIQUE
                     · workspace_id uuid NULL UNIQUE FK workspaces Cascade · created_by_id FK users Restrict
                     · last_message_at timestamptz NULL · last_message_id uuid NULL · created_at · updated_at
                     CHECK: DIRECT ⇔ direct_key NOT NULL; WORKSPACE ⇔ workspace_id NOT NULL; GROUP ⇔ title NOT NULL
chat_participants    (conversation_id FK Cascade, user_id FK Restrict) PK · role ChatParticipantRole · joined_at · left_at NULL
                     INDEX (user_id, left_at)                          -- chỉ DIRECT/GROUP (use case đảm bảo + test CH-10; không trigger)
chat_read_states     (conversation_id FK Cascade, user_id FK Restrict) PK · last_read_message_id uuid NULL · muted bool default false · updated_at
chat_messages        id uuid PK · conversation_id FK Cascade · sender_id FK Restrict · client_msg_id uuid
                     · body text NULL (CHECK char_length ≤ 4000) · reply_to_id uuid NULL FK chat_messages SetNull
                     · created_at · edited_at NULL · deleted_at NULL
                     UNIQUE (sender_id, client_msg_id) · INDEX (conversation_id, created_at, id) · INDEX (created_at) -- retention
chat_attachments     id uuid PK · uploader_id FK Restrict · message_id uuid NULL FK chat_messages SetNull
                     · kind {IMAGE, FILE} · original_name varchar(255) · mime varchar(100) · size_bytes int · sha256 char(64)
                     · width int NULL · height int NULL · file_key · preview_key NULL · thumb_key NULL · created_at
                     INDEX (message_id) · partial INDEX (created_at) WHERE message_id IS NULL  -- mồ côi
                     INDEX (uploader_id, created_at)                   -- hạn mức ngày
```
- Tin bị xóa: `message_id` của đính kèm ⇒ NULL cùng transaction ⇒ thành mồ côi ⇒ sweep xóa blob. Đếm dung lượng kho = `SUM(size_bytes)` + biến thể (ước) — cache 60 s.
- `last_message_*` cập nhật trong transaction gửi (dòng nóng ở nhóm đông — chấp nhận ở quy mô một công ty).
- Seed (chặn production): DIRECT Mia↔Vic, nhóm "Dự án Sao Mai" (Mia OWNER, Vic, Otto), phòng ws mẫu, vài tin + một ảnh mẫu tạo bằng sharp lúc seed (không commit ảnh thật).

## 4. API (`/api/v1/…`, contracts Zod `.strict()` + OpenAPI)

| Route | Ai | Ghi chú |
|---|---|---|
| `PUT/DELETE me/avatar` | chính mình | octet-stream ≤ 5 MB |
| `DELETE hr/employees/:userId/avatar` | `hr:manage` (Admin cho Admin/người có grant) | audit `AVATAR_REMOVED` |
| `GET chat/people?q` | thuộc công ty | không email |
| `GET chat/conversations?cursor` | thuộc công ty | keyset `last_message_at desc, id`; mỗi mục: kind, title / người kia / ws, tin cuối (đã cắt 140 ký tự), `unread`, `muted`, `canSend` |
| `GET chat/unread-count` | thuộc công ty | tổng cho badge header |
| `POST chat/direct {userId}` · `POST chat/groups {title, memberIds}` · `PUT chat/workspaces/:wsId/conversation` | thuộc công ty / thành viên ws | tạo-hoặc-lấy |
| `GET chat/conversations/:id` · `PATCH …/:id {title}` · `POST/DELETE …/:id/members[/:userId]` · `PUT …/:id/owner {userId}` · `POST …/:id/leave` | người tham gia / OWNER | chỉ GROUP (khác ⇒ 422 `NOT_GROUP`) |
| `GET …/:id/messages?before\|after&limit` · `POST …/:id/messages` | người tham gia | `Idempotency` qua `clientMsgId` |
| `PATCH chat/messages/:id {body}` · `DELETE chat/messages/:id` | người gửi | 15 phút / bất cứ lúc nào |
| `PUT …/:id/read {messageId}` · `PUT …/:id/mute {muted}` | người tham gia | |
| `POST chat/uploads?as=image\|file` · `POST chat/attachments/:id/download-url` | thuộc công ty / người tham gia | URL 60 s |
| `GET media/avatars/:userId/:version/:size` · `GET media/chat/:attachmentId/:variant` | chữ ký | không Bearer |

Lỗi mới: 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_FILE_TYPE`, 422 `SELF_DIRECT` / `RECIPIENT_INACTIVE` / `NOT_GROUP` / `EDIT_WINDOW_PASSED` / `REPLY_OTHER_CONVERSATION` / `GROUP_TOO_LARGE`, 507 `STORAGE_FULL`, 503 `IMAGE_PROCESSING_UNAVAILABLE`.

## 5. Bảo mật — ca SEC cho F (B rà, T-074)

| ID | Kịch bản | Mong đợi |
|---|---|---|
| SEC-CH-01 | IDOR: Otto đọc tin / gửi / đánh dấu đọc / sửa / xóa ở DIRECT Mia↔Vic bằng id thật | 404 mọi lệnh; DB không đổi |
| SEC-CH-02 | Otto gắn `attachmentIds` là upload của Mia; xin `download-url` của file ở nhóm mình không thuộc | 404 |
| SEC-CH-03 | Ada (Admin), Hana (HR) gọi mọi route chat với id hội thoại của người khác, phòng ws mình không là thành viên | 404 — không quyền ngầm |
| SEC-CH-04 | Bị bớt khỏi ws / nhóm rồi dùng CÙNG token: đọc lịch sử, gửi, `typing`; socket còn mở có nhận `chat:message:new` kế tiếp không | 404; không nhận event |
| SEC-CH-05 | Người hết `access_until` (job phút chưa chạy) gọi chat REST; socket còn mở | 401 `SESSION_REVOKED`; không nhận event chat (lọc lúc phát) |
| SEC-CH-06 | Upload `evil.html`, SVG có `<script>`, PNG đổi đuôi `.exe`, EXE đổi đuôi `.pdf`, `.docm`, ZIP thuần, polyglot GIF+JS | 415 (trừ polyglot GIF ⇒ bị mã hóa lại, byte đầu ra không chứa payload) |
| SEC-CH-07 | Ảnh JPEG có EXIF GPS gửi dạng ảnh + làm avatar | biến thể tải về không còn EXIF/GPS |
| SEC-CH-08 | Pixel bomb (PNG 50 000×50 000), file 21 MB, chunked không Content-Length 25 MB, avatar 6 MB | 413/422 trong ≤ 2 s, RAM process không tăng đột biến, không file tmp sót |
| SEC-CH-09 | `X-Upload-Name: ../../etc/passwd`, `‮gpj.exe`, tên 1 000 byte, NUL | lưu đĩa theo khóa server; `filename*` đã làm sạch; không ghi ngoài `FILE_STORE_DIR` |
| SEC-CH-10 | Header phục vụ file: ảnh, PDF, TXT chứa HTML | `nosniff`, `CSP sandbox`, `attachment` + `octet-stream` cho không-ảnh |
| SEC-CH-11 | URL ký: sửa `exp`/`sig`/path, dùng chữ ký avatar cho file chat, URL hết hạn, `download-url` sau 61 s | 404 như nhau |
| SEC-CH-12 | Upload với `Content-Type: multipart/form-data` / `text/plain` (dạng "simple request") không Bearer | 415 / 401 — không ghi |
| SEC-CH-13 | XSS: thân `<img src=x onerror=…>`, `javascript:alert(1)`, tên nhóm / file chứa HTML | hiện nguyên văn; không link `javascript:` (E2E đọc DOM) |
| SEC-CH-14 | Hạn mức: 31 tin / phút, 31 upload / 10 phút, vượt 200 MB / ngày | 429 + `Retry-After`; tin không bị ghi |
| SEC-CH-15 | GROUP: thành viên thường thêm/bớt người, đổi tên, giao OWNER; thêm người đã nghỉ / chờ kích hoạt / id lạ | 403; 422 `NOT_ACTIVE_MEMBER` (lạ ⇒ 404 user) |
| SEC-CH-16 | Sửa / xóa tin người khác; sửa sau 15 phút; sửa tin đã xóa | 404; 422; 404 |
| SEC-CH-17 | Gỡ avatar: Mia gỡ của Vic; Hana gỡ của Ada / Kay (grant) / chính mình qua route HR; Ada gỡ của Hana | 403; 403; 403; 204 + audit `AVATAR_REMOVED` |
| SEC-CH-18 | `chat/people` không trả email, không trả người đã rời / chờ kích hoạt | đúng |
| SEC-CH-19 | Socket `chat:typing` cho hội thoại không thuộc; spam 10 / giây | không ai nhận; bị bỏ qua sau 1 / 3 s |
| SEC-CH-20 | Log / Sentry không chứa thân tin, tên file, `sig` | grep log của suite rỗng |

## 6. Test (F viết `test-spec-chat.md`, T-073)

- **AV-\*** (U/I, G viết): AV-01 version tăng đơn điệu + xóa version cũ sau commit; AV-02 sharp ra 256/64 WebP, không metadata; AV-03 `avatarUrlOf` khung 24 giờ ổn định trong khung; AV-04 người đã rời ⇒ `avatarUrl null`; AV-05 sweep xóa avatar người rời > 30 ngày, giữ người nhận lại; AV-06 sharp không nạp ⇒ 503, app vẫn chạy.
- **CH-\*** (U/I): CH-01 `directKey` đối xứng; CH-02 `effectiveGroupOwners`; CH-03 `sniffType` bảng magic (gồm biên: file < 4 byte, ZIP không phải Office, UTF-8 hỏng); CH-04 `sanitizeFileName`; CH-05 chuẩn hóa thân + biên 4 000/4 001 code point (emoji ghép); CH-06 con trỏ đọc chỉ tiến; CH-07 trần 99; CH-08 keyset `before`/`after` cùng `created_at`; CH-09 `verifyMediaSig` (constant-time, hết hạn biên ±1 s); CH-10 phòng ws: thành viên tính lúc đọc, ws xóa mềm / lưu trữ ⇒ không ai; CH-11 retention biên ±1 ngày, không đụng tin chưa hạn; CH-12 sweep không xóa upload đang ghi (< 24 giờ).
- **CC-CH-\*** (tầng C ×20): CC-CH-01 cùng `clientMsgId` gửi song song 5 lần ⇒ 1 dòng, 1 event; CC-CH-02 Mia và Vic cùng `POST chat/direct` nhau ⇒ 1 hội thoại; CC-CH-03 OWNER rời ‖ OWNER bớt người cuối ⇒ không nhóm vô chủ trái luật; CC-CH-04 2 `PUT me/avatar` song song ⇒ version cuối khớp blob còn trên đĩa, không blob mồ côi sau sweep; CC-CH-05 `PUT read` lệch thứ tự ⇒ con trỏ = max; CC-CH-06 gắn cùng upload vào 2 tin song song ⇒ đúng 1 thành công; CC-CH-07 xóa tin ‖ sweep ‖ tải file ⇒ không 500.
- **E2E-CH-\*** (Playwright, 360 px + desktop): E2E-CH-01 tải avatar + cắt ⇒ hiện ở header, board, thành viên; E2E-CH-02 Mia nhắn Vic ⇒ Vic (2 tab) thấy realtime + badge; đọc ⇒ badge về 0 ở cả 2 tab; E2E-CH-03 tạo nhóm, gửi ảnh (kéo-thả + dán), xem ảnh lớn, gửi PDF ⇒ chip tải về; E2E-CH-04 phòng ws từ trang ws; bị bớt khỏi ws ⇒ phòng biến mất; E2E-CH-05 mất mạng → gửi → nối lại ⇒ không trùng tin; E2E-CH-06 cuộn lên tải lịch sử giữ vị trí; E2E-CH-07 a11y (axe) trang chat, `aria-live` đọc tin đến.
- **Hiệu năng** (đo khi máy rảnh, ADR-107): seed 100 000 tin / hội thoại — `GET messages` p95 ≤ 150 ms; danh sách 50 hội thoại kèm unread p95 ≤ 200 ms; gửi → event tới người nhận p95 ≤ 300 ms (local); phòng ws 300 người: một lần `io.to()`; upload 20 MB không chặn event loop > 50 ms (sharp ngoài luồng chính). k6 sau v1.
- **Stryker** (chỉ khi TL báo máy rảnh): `chat/domain` + `core/files/domain` (`sniffType`, `sanitizeFileName`, `directKey`, `effectiveGroupOwners`, `chatPolicy` — canSend/canEdit/canManage, `nextReadPointer`, `normalizeBody`, `verifyMediaSig`, `mediaExpBucket`) ≥ 90 %.

## 7. Web (H)

- **Header** (mọi người kể cả Admin): nút "Trò chuyện" có badge (tổng chưa đọc, 99+) cạnh chuông ⇒ `/chat`. Trang ws: link "Trò chuyện" ⇒ `/chat/ws/[wsId]` (gọi `PUT chat/workspaces/:wsId/conversation` rồi chuyển tới `/chat/[id]`).
- `/chat` (danh sách) + `/chat/[conversationId]` (luồng tin). < md: hai màn toàn màn hình, nút quay lại; ≥ md: hai cột. Danh sách: avatar / tên / tin cuối / giờ / badge / biểu tượng tắt tiếng; "Tin nhắn mới" (chọn người) và "Tạo nhóm" (combobox nhiều người từ `chat/people`).
- Luồng tin: cuộn ngược vô hạn (`before`), giữ vị trí khi chèn trang cũ; nhóm tin liên tiếp cùng người; vạch "Tin chưa đọc"; reply (trích dẫn ngắn), sửa/xóa qua menu tin của mình; "Đã xem" ở DIRECT.
- Composer: textarea tự giãn (Enter gửi / Shift+Enter xuống dòng trên desktop; mobile Enter xuống dòng + nút Gửi), đính kèm qua nút / kéo-thả / dán; chip tiến trình upload, hủy được; vượt 20 MB / sai loại báo ngay phía client (server vẫn kiểm). Ảnh: thumb trong tin, bấm mở xem lớn (dialog, Esc đóng); file: chip tên (cắt giữa) + kích thước + nút tải (gọi `download-url`).
- Realtime: `features/chat-realtime` nghe event qua `shared/socket` hiện có, vá cache TanStack Query (`['chat', …]`, xóa khi đăng xuất / `SESSION_REVOKED`); nối lại ⇒ bù theo ADR-145. Gửi lạc quan với `clientMsgId`, lỗi ⇒ "Gửi lại".
- a11y: vùng tin `role="log" aria-live="polite"` chỉ báo tin **đến** (không báo khi tải lịch sử); nút có nhãn; focus về composer sau gửi; tương phản theo `frontend.md`.
- Avatar: `shared/ui/avatar` thêm `src`; trang `/account` thêm "Ảnh đại diện" (chọn, cắt, xem trước 64/256, xóa); `/hr/employees` thêm "Gỡ ảnh đại diện" (hộp xác nhận) — **chỉ 1 nút trong 1 file widget HR**, phối hợp với đội Mốc 5 khi merge.
- MSW (`app/mock-api`) handler chat/avatar từ contracts ⇒ H làm song song trước khi G xong.

## 8. Rủi ro mới (B ghi `threat-model.md` §6)

| # | Rủi ro | Vì sao chấp nhận | Xem lại khi |
|---|---|---|---|
| R43 | URL media ký là bearer: lộ URL ⇒ người ngoài xem ảnh tới hết khung (avatar ≤ 48 giờ, ảnh chat ≤ 2 giờ, file ≤ 60 giây); không thu hồi được khi người xem mất quyền | `<img>` không gửi Bearer; URL chỉ phát cho người có quyền; `no-referrer`, redact log | Có dữ liệu ảnh nhạy cảm, hoặc chuyển sang cookie media cùng site |
| R44 | Người bị bớt khỏi nhóm / ws / nghỉ việc vẫn mở được ảnh chat đã tải trong ≤ 2 giờ | Như R43; họ vốn đã xem được lúc còn quyền | Như R43 |
| R45 | Không quét virus file chat (nếu Q4 = không) | Danh sách cho phép hẹp, không file chạy được / macro / nén, luôn tải xuống, ảnh mã hóa lại | Cho phép file nén, hoặc có sự cố |
| R46 | Tin nhắn không mã hóa đầu-cuối; người có quyền DB / backup / ổ file đọc được | Công cụ nội bộ; Admin/HR không có đường app; thông báo cho nhân viên | Có yêu cầu bảo mật trao đổi cao hơn |
| R47 | Kho file trên ổ một máy: hỏng ổ / mất máy ⇒ mất file từ lần backup cuối; không scale ngang | Người dùng chọn lưu trên máy công ty; backup hằng ngày (T-067) | ≥ 2 instance ⇒ volume chung / MinIO tự host |
| R48 | Dữ liệu đã xóa (tin, file, avatar) còn trong bản sao lưu tới hết tầng giữ | Như DB (runbook backup) | Có yêu cầu xóa ngay |

## 9. Chia việc và thứ tự

| Vé | Ai | Nội dung | Phụ thuộc | Ước tính |
|---|---|---|---|---|
| T-067 | G | `core/files`: `IFileStore` + `LocalFileStore` (tmp + rename, khóa regex), `rawUpload`, `sniffType`, `sanitizeFileName`, ký/kiểm URL media, pipeline sharp (giới hạn, hàng đợi, dự phòng), `IMalwareScanner` Noop, router `/media`, hạn mức + `STORAGE_FULL`, job `files-sweep`, env (`FILE_STORE_DIR`, `FILE_URL_SECRET`, `FILE_STORE_MAX_BYTES`), volume compose, metrics; runbook backup thêm mục file (restic hoặc `tar \| age` theo Q5) | — **(đầu tiên)** | 2,5 ngày |
| T-068 | G | Migration `avatar_chat` (cả bảng chat — một migration), avatar: `PUT/DELETE me/avatar`, `DELETE hr/employees/:userId/avatar` + audit, `avatarUrlOf`, `UserRefDto.avatarUrl` ở auth/task/workspace/notifications, event `user:avatar-changed` | T-067 | 1,5 ngày |
| T-069 | G | Module `chat`: domain thuần (§6 Stryker), contracts, DIRECT/GROUP/WORKSPACE, `IWorkspaceChatAccess`, tin (keyset, idempotent, sửa/xóa, reply), upload + gắn, `download-url`, read/mute/unread, `chat/people`, hạn mức, job `chat-retention`, seed | T-068 (migration) | 3,5 ngày |
| T-070 | G | Realtime chat: phát tới `user:` lọc công ty, 6 event + `chat:typing` (throttle, cache quyền), test I với 2 socket / 2 tab | T-069 | 1 ngày |
| T-071 | H | `Avatar src` + rơi về chữ cái mọi nơi, `/account` cắt + tải, nút gỡ ở `/hr/employees`, CSP `img-src` | contracts T-068; MSW trước | 1,5 ngày |
| T-072 | H | Chat UI §7 (danh sách, luồng, composer + đính kèm, nhóm, phòng ws, realtime, a11y, 360 px) | contracts T-069; MSW trước; realtime sau T-070 | 4 ngày |
| T-073 | F | `test-spec-chat.md`, harness (người + ws qua ADR-140, file mẫu tạo lúc chạy), SEC-CH-01…20, CC-CH-01…07, E2E-CH-01…07, Stryker | song song; S/C sau T-069/T-070; E2E sau T-072 | 3 ngày |
| T-074 | B | Review T-067 (lưu file, header, URL ký) + T-069 (IDOR, phân quyền); `threat-model.md` R43–R48; `data-retention.md` D12–D14 + đoạn thông báo; `security.md` W-CSP-2 + mục upload | review theo vé | 1 ngày |
| — | TL | `DECISIONS.md` ADR-141…148 sau duyệt; tạo/merge `feat/avatar-chat`; gộp file chung khi Mốc 4/5 merge | sau duyệt | 0,5 ngày |

Thứ tự: **T-067 → T-068 → T-069 → T-070**; H bắt đầu T-071/T-072 từ contracts + MSW ngay khi G commit contracts; F viết spec từ ngày 1. **Đường găng G ≈ 8,5 ngày**; H ≈ 5,5 ngày song song; tổng lịch ≈ 9–10 ngày làm việc + verify gộp, tùy tải máy (ADR-107). Việc nặng (Stryker, Playwright, sharp trong Docker build) không chạy cùng lúc với việc nặng của Mốc 4/5.

## 10. Câu hỏi cho người dùng

1. **Thời hạn lưu tin nhắn + file chat:** đề xuất **24 tháng** rồi tự xóa (khớp chấm công). Hay giữ suốt thời gian công ty dùng, hoặc ngắn hơn (12 tháng)?
2. **Kiểm duyệt:** đề xuất v1 **không ai** (kể cả Admin) đọc/xóa tin của người khác; Admin/HR chỉ gỡ được **ảnh đại diện** không phù hợp. Có cần nút "Báo cáo tin nhắn" để Admin xóa tin vi phạm (Admin chỉ thấy tin bị báo cáo) không? Nếu có ⇒ làm sau v1.
3. **Dung lượng:** file chat tối đa **20 MB**/file, ảnh đại diện **5 MB**, tổng kho **50 GB** — đổi không?
4. **Quét virus:** bật ClamAV (miễn phí, nhưng tốn ~1–1,5 GB RAM máy chủ) hay chấp nhận không quét + chỉ cho loại file an toàn (R45)? Nếu không quét: **không** cho gửi file nén (.zip/.rar).
5. **Máy chủ và sao lưu file:** file nằm trên ổ máy chủ của công ty — máy đó là máy tại văn phòng hay VPS thuê? (Phương án hosting mặc định trong `devops.md` là dịch vụ managed **không có ổ đĩa lâu dài** ⇒ phải đổi sang VPS/máy riêng.) Bản sao lưu file đi chung kho backup mã hóa của DB (có thể tốn vài USD/tháng) hay ra ổ thứ hai của máy chủ?
