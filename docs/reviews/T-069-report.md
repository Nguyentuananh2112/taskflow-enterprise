# T-069 — Trò chuyện: use case + route (Engineer G) — báo cáo

> **Trạng thái:** DONE ở mức test nhỏ; tầng I và cổng đầy đủ chờ lượt của TL.
> **Nhánh:** `feat/T-069`, đã đồng bộ tip `feat/avatar-chat` @080b7b79. Domain, migration và store là phần T-069a
> của D.
> **Căn cứ:** `docs/design/avatar-chat.md` v2.1 (ADR-141, ADR-143…147), `test-spec-chat.md` (F).

## Lệch / quyết định cần TL ghi nhận

1. **"chat-retention" gộp vào `files-sweep`.** Thiết kế ghi job riêng chạy hằng ngày. Tôi làm thành một bước `chat`
   của `files-sweep`, chạy mỗi giờ: tin quá 12 tháng (giờ nghiệp vụ) cùng đính kèm của chúng; upload mồ côi quá 24
   giờ; ghi `left_at` cho người không còn dòng `company_members`; blob không còn dòng nào tham chiếu.
   - **Lý do:** dùng chung advisory lock và cùng mẫu "xóa DB trước, đĩa sau commit". F đã có hook
     `FILES_SWEEP_ON_START` / `FILES_SWEEP_INTERVAL_MS` cho CLK-CH.
   - Mọi bước chạy theo lô (500, tối đa 20 lô mỗi bước mỗi lượt) và idempotent. Chạy mỗi giờ thay vì mỗi ngày chỉ
     khiến việc dọn đến sớm hơn.
2. **Ngân sách byte / ngày.** Hạn mức hiện có chỉ đếm lượt, không đếm được byte. Tôi thêm `core/files/upload-byte-budget.ts`:
   - Valkey `INCRBY ub:<user>:<ngày giờ VN>` + `EXPIRE` 2 ngày; bản bộ nhớ dùng ở local/test.
   - Vượt trần ⇒ trả lại phần vừa cộng rồi 429; `retryAfter` = thời gian tới nửa đêm giờ VN.
   - Valkey lỗi ⇒ 503 (fail-closed, ADR-141).
   - Đếm sau khi biết kích thước bản tạm, trước khi xử lý / ghi kho.
3. **`IFileStore.list('random')`.** Duyệt mọi blob khóa ngẫu nhiên, đặt đúng vị trí `ab/cd/<key>`, để tìm blob không
   còn tham chiếu. Hiện chỉ chat dùng khóa ngẫu nhiên.
4. **Ảnh gửi dạng ảnh:**
   - `fileKey = previewKey`, vì không giữ bản gốc mà cột `file_key` là NOT NULL.
   - `mime = image/webp`; `sizeBytes` và `sha256` lấy theo bản tải lên (metadata D14).
   - `download-url` chỉ cấp cho FILE; với ảnh trả 404 (ảnh đã có URL ký sẵn).
5. **WORKSPACE `members[].joinedAt`** = lúc tạo phòng, vì `workspace_members` không có ngày vào phòng chat.
6. **`chat` chỉ được mount khi có kho tệp** (như `/me/avatar`), nên test HTTP cũ không đổi.
   `Persistence.chat` + `allModules.chat`: guard production xét luôn module chat.
7. **Contracts:**
   - `NotFoundDetails.resource` thêm `conversation` / `message` / `attachment`.
   - `BusinessRule` thêm `ATTACHMENT_UNAVAILABLE` (lưới an toàn của store D — B soát T-069a M1).
   - `SendMessageBody.attachmentIds` không được trùng ⇒ 400 (B).
   - OpenAPI có danh mục `chat-routes.ts` + tag `chat`. Kiểu route tách sang `route-types.ts` để bỏ vòng phụ thuộc.
8. **Port `ChatDirectory` của D đổi sang async** theo yêu cầu của TL: adapter bộ nhớ dùng API async của store
   company / auth / workspace, không đọc Map nội bộ. Thêm `findByClientMsgId` (D, 5281212a).

## Luồng chính

- **Thứ tự lỗi (ADR-146):** authenticate → cổng công ty (401 `SESSION_REVOKED`) → hạn mức → validate (400) →
  không phải người tham gia (404, cùng hình dạng với "không tồn tại") → luật (422) / 403 (không phải OWNER).
  Mọi response `no-store`.
- **Gửi tin, idempotent:**
  1. Tra `findByClientMsgId`: có ⇒ cùng `request_hash` thì trả tin cũ 200, không event; khác hash ⇒ 422
     `IDEMPOTENCY_KEY_REUSED`.
  2. `claimableUploads` FOR UPDATE: thiếu ⇒ tra trùng lại lần nữa (lệnh song song vừa commit — CC-CH-01), rồi mới 404.
  3. `insert` trả `created=false` ⇒ so hash.
  4. Người gửi tự đánh dấu đã đọc tin của mình.
  5. DIRECT: người kia đã nghỉ ⇒ 422 `RECIPIENT_INACTIVE`.
- **Sửa / xóa:**
  - Tin người khác / tin đã xóa / hội thoại không còn quyền ⇒ 404 (SEC-CH-16).
  - Khóa dòng rồi đọc lại.
  - Xóa: store xóa dòng đính kèm cùng transaction; blob xóa sau commit.
- **Quản trị nhóm:**
  - Khóa hội thoại, đọc lại participant sau khóa. Bị bớt giữa chừng ⇒ 404, không phải 403.
  - OWNER ngầm: thao tác đầu tiên ghi `role = OWNER`.
  - Bớt / rời ⇒ `conversationRemoved` cho người đó.
- **Sự kiện:** mọi event (`IChatNotifier`) phát trong `afterCommit` của transaction ngoài cùng (bài học B L2 T-068).
  T-069 nối no-op; T-070 nối realtime.
- **`/media/chat`:** đính kèm phải còn gắn tin chưa xóa và chưa quá 12 tháng; IMAGE ⇒ `preview` / `thumb`, FILE ⇒
  `file` (attachment + tên sạch).
- **Hạn mức:**
  - Gửi: 30 / phút + 600 / giờ (`CHAT_SEND_HOURLY`).
  - Sửa: 30 / phút.
  - Tạo nhóm: 20 / ngày.
  - `chat/people`: 60 / phút.
  - Upload: 30 / 10 phút, fail-closed; 200 MB / ngày (`CHAT_UPLOAD_DAILY_BYTES`); ≤ 3 đồng thời
    (UploadSlots T-067).
- **Env test-only mới:** `CHAT_EDIT_WINDOW_SECONDS`, `CHAT_UPLOAD_DAILY_BYTES`, `CHAT_SEND_HOURLY`.

## Commit

| Commit | Nội dung |
|---|---|
| 125f6863, 499f50df, eb25b0f7 | merge: T-068; T-069a (ChatDirectory async + `findByClientMsgId`); tip `feat/avatar-chat` |
| 83213195 | use case + DTO + port (tên-ảnh, media, notifier, upload); test U 22 ca |
| f454c02d | route `/chat`, module, wiring composition, xử lý upload, resolver, ngân sách byte, env, OpenAPI; test HTTP 11 ca |
| 276c5f7d | `ATTACHMENT_UNAVAILABLE` (D cherry-pick) |
| c474a9e3 | bước sweep `chat`, `list('random')`, test ngân sách byte, chặn `attachmentIds` trùng |
| 6ca33c26 | seed trò chuyện |
| 0f5af151 | tách `route-types.ts` (depcruise) |

## Kiểm thử (chỉ test nhỏ, ≤ 2 worker)

| Bộ | Kết quả |
|---|---|
| U use case (`open-conversation`, `group-admin`, `messages`): CH-06/08/10/15, SEC-CH-01/02/15/16 ở mức đơn vị | 22/22 |
| HTTP `chat.http.test.ts` (DIRECT + tin + đọc, IDOR Otto/Ada, 401 / 400 / 422, nhóm 403, people, phòng ws) | 6/6 |
| HTTP `chat-files.http.test.ts` (ảnh WebP không EXIF, xóa ⇒ 404 ngay, PDF + `filename*` tiếng Việt, macro 415, byte / ngày 429) | 5/5 |
| `chat-sweep.test.ts` (CH-11 biên 12 tháng, CH-12 mồ côi, blob không tham chiếu) + `upload-byte-budget.test.ts` | 3/3 + 4/4 |
| Gộp: `src/modules/chat`, `src/composition`, `src/core/files`, `src/core/http`, `src/config`, HTTP chat/avatar, parity OpenAPI, `test/contract` | **652/652** (46 file) |
| contracts | 172/172 |
| tsc (api + contracts), eslint, prettier, dependency-cruiser | sạch |
| Tầng I: use case chat trên Prisma, `seed.int.ts` có chat | **chưa chạy — chờ lượt TL** |

Ca S / C (SEC-CH-*, CC-CH-*) là phần F viết (T-073). Các test trên chỉ là U / HTTP của tác giả.

## Còn mở

- T-070: nối `IChatNotifier` vào gateway (`user:{id}` lọc công ty), `chat:typing`, gỡ 6 event chat khỏi
  `PENDING_SERVER_EMIT`.
- `IChatUserRefs` đọc tên qua reader của Task (đã bọc ảnh) cộng `avatarRefs` ⇒ ảnh bị truy vấn 2 lần mỗi lô. Đúng
  nhưng thừa; sẽ tối ưu nếu B / TL muốn.
