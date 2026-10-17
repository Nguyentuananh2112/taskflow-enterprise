# Mốc 6 — Avatar và Trò chuyện (thiết kế, CHỜ người dùng duyệt)

> Trạng thái: **đề xuất v2 — chờ người dùng duyệt** (Tech Lead, 2026-10-17). ADR-141…148 chỉ vào `DECISIONS.md` sau khi duyệt; rủi ro R43–R49 vào `threat-model.md` §6 (B, T-074). Vé T-067…T-074. Chưa ai code trước khi duyệt.
> Căn cứ: `company-level.md` v2.1 (ADR-133…140), `data-retention.md` (R27), `threat-model.md` (tới R42), `security.md` §5–6, `devops.md` §1/§4.3, runbook `backup-restore.md`, `schema.prisma` @0dcaaf4 (migration 5), `core/realtime/*` (phòng `user:` / `session:` / `project:`, `companyGatedSocketAuthenticator`), `core/http/middleware.ts` (`requireJsonContentType`, body 100 kB), `IWorkspaceExitPort`, web `shared/ui/avatar`, `app/security/csp.ts`. Phản biện: B (bảo mật/lưu file), E (web), F (`docs/reviews/F-m6-avatar-chat-review.md` @642c40b) — ghi nguồn tại chỗ. Dữ liệu ví dụ là bịa.
> **Chạy song song Mốc 4/5** bằng đội riêng: **G** (backend), **H** (web), **F** (test), B review. Không đụng module `payroll`, `leave`, `attendance`, `hr`, `company` (trừ chỗ ghi rõ ở ADR-148).

**v2 — phản biện B/E/F + trả lời người dùng** (v1 @ 2a0ab9a)
- Người dùng 17/10: lưu tin + tệp **12 tháng**; **không** quét virus, **cấm** tệp nén / chạy được, chặn macro theo nội dung; giữ 5 MB / 20 MB / 10 tệp / 50 GB; hosting "chưa biết" ⇒ TL chốt thiết kế cho máy có ổ lâu dài (ADR-141), hỏi lại **trước deploy**.
- TL chốt: kiểm duyệt v1 — không ai đọc/xóa tin người khác, nút "Báo cáo" để sau; các hành vi F-03 (ADR-143/144); nghỉ việc ⇒ rời mọi nhóm, nhận lại không tự có lại nhóm (không cần hook — ADR-143); tải file = `POST download-url` + `location.assign` (không 302).
- B: HIGH-1 hosting/backup; HIGH-2 sharp trong worker, kiểm format trước biến đổi; M1 ngoại lệ content-type đúng method+path; M2 CORP theo hosting; M3 ký tuple chuẩn hóa + xoay khóa; M4 `/media` kiểm DB mỗi lần; M5 cắt query khỏi log; M6 Office theo central directory; M7 trần đồng thời/timeout/proxy/ổ trống/fail-closed; M8 R46 + NĐ 13; L1 typing ≤ 5 s; L3 CSV công thức; L4 danh bạ thành R49; SEC-CH-21…25.
- E: 13 điểm web (§7) + luồng tải tệp (gọi ngay, `attachment` + `filename*`, trang lỗi HTML, không "Tải tất cả", checklist PWA/Zalo). F: F-01…F-11, harness, T-073 ≈ 6 ngày chia ca cho G/H.

## 0. Quyết định

| Quyết định | Nguồn | ADR |
|---|---|---|
| Mỗi người tự tải ảnh đại diện (cắt vuông, giới hạn dung lượng); không ảnh ⇒ chữ cái | Người dùng 17/10 | ADR-142 |
| Tệp lưu trên **ổ đĩa máy chủ** (volume), **không** dịch vụ lưu trữ cloud trả phí | Người dùng 17/10 | ADR-141 |
| Ba loại hội thoại: **1-1**, **nhóm tự tạo**, **phòng của mỗi workspace**. **Không** kênh toàn công ty | Người dùng 17/10 | ADR-143 |
| Gửi ảnh và tệp ngay từ v1 | Người dùng 17/10 | ADR-141, ADR-144 |
| Lưu tin + tệp **12 tháng** | Người dùng 17/10 | ADR-147 |
| **Không** quét virus; **cấm** tệp nén, tệp chạy được; chặn macro theo **nội dung** | Người dùng 17/10 | ADR-141, R45 |
| Giới hạn: avatar 5 MB, tệp 20 MB, ≤ 10 tệp / tin, kho 50 GB | Người dùng 17/10 | ADR-141 |
| Hosting chưa chốt ⇒ thiết kế cho máy **có ổ lâu dài** (VPS hoặc máy văn phòng, Docker Compose + volume); adapter đổi được; người dùng chốt hosting **trước deploy** | TL (người dùng "chưa biết") | ADR-141 |
| Kiểm duyệt v1: **không ai** (kể cả Admin) đọc/xóa tin người khác; "Báo cáo tin nhắn" sau v1 | **TL chốt** | ADR-146 |
| Admin/HR gỡ được avatar không phù hợp (có audit) | TL | ADR-142 |
| Phòng workspace: thành viên **tính lúc đọc** từ `workspace_members`; VIEWER đọc + gửi được | TL (F-03d) | ADR-143 |
| Nghỉ việc ⇒ rời mọi nhóm; nhận lại **không** tự có lại nhóm; DIRECT cũ hiện lại | TL (F-03g) | ADR-143 |
| Realtime phát tới `user:{id}` của từng người nhận | TL | ADR-145 |
| Không thông báo chuông / email / push cho chat — chỉ badge riêng | TL | ADR-145 |
| Tải lên = body nhị phân `application/octet-stream`; ảnh/tệp phục vụ qua **URL ký** có hạn | TL (B M1/M3) | ADR-141 |

## 1. Phạm vi

**Có:** avatar (tải, cắt, gỡ, hiển thị mọi nơi đang có chữ cái); 1-1, nhóm, phòng ws; văn bản ≤ 4 000 ký tự, trả lời, sửa ≤ 15 phút, xóa của chính mình; ảnh + tệp đính kèm; chưa đọc / đã xem; đang gõ; tắt tiếng; realtime + bù khi nối lại; retention 12 tháng.
**Không (v1):** kênh toàn công ty, tìm kiếm nội dung, reaction, ghim, chuyển tiếp, gọi thoại/video, xuất lịch sử, báo cáo vi phạm, email/push, mã hóa đầu-cuối, video/âm thanh, tệp nén, quét virus.

## 2. ADR đề xuất

**ADR-141 — Kho tệp: port `IFileStore` + adapter ổ cục bộ; URL ký; ảnh mã hóa lại trong worker.**
- **Hosting (B HIGH-1):** Mốc 6 cần máy có **ổ lâu dài** — VPS hoặc máy văn phòng chạy Docker Compose + volume. Ứng viên mặc định hiện tại của `devops.md` §1.3 (App Platform) **không có ổ lâu dài** ⇒ B sửa `devops.md` (T-074) đổi ứng viên mặc định sang phương án A (VPS + Compose + Caddy) hoặc droplet + volume; thêm vào `security-go-live.md` mục **"Người dùng chốt hosting (có ổ lâu dài) — bắt buộc trước deploy"**. Code chỉ biết `IFileStore` ⇒ adapter MinIO/S3 tự host sau này không đổi use case.
- **Port** `core/files/ports.ts` (core không import module — ADR-016): `put(buffer|stream, {maxBytes}) → {key, sizeBytes, sha256}` · `open(key) → Readable` (ENOENT ⇒ `FileMissingError`) · `delete(key)` · `exists(key)`. Adapter `LocalFileStore`.
- **Đường dẫn:** `FILE_STORE_DIR` (tuyệt đối, ngoài app/web root; không tồn tại / không ghi được ⇒ từ chối khởi động). Docker: volume `filestore:/var/lib/taskflow/files`, chủ `node`. **Khóa do server sinh**: 128 bit ngẫu nhiên base32, thư mục `ab/cd/<key>`; không tên người dùng, không content-addressed. Ghi `tmp/<key>` → `fsync` → `rename`; `rename` gặp `EPERM`/`EBUSY`/`EACCES` ⇒ thử lại ≤ 5 × 50 ms (Windows + Defender — F-07); lỗi / hủy ⇒ xóa tmp **ngay**. Kiểm `key` bằng regex trước mọi thao tác đĩa. Trước khi mở tmp: kiểm ổ trống ≥ `maxBytes` + 10 % (B M7), không đủ ⇒ 507.
- **Tải lên = body nhị phân** `application/octet-stream`, tên gốc trong header **bắt buộc** `X-Upload-Name` (percent-encoded UTF-8 — web dùng `encodeURIComponent`; thiếu / giải mã hỏng / > 255 byte sau giải mã ⇒ **400** `INVALID_UPLOAD_NAME` — F-03c). Không multipart, không thêm busboy/multer.
  - **CSRF (B M1):** lớp chính là **Bearer** (không cookie ⇒ trang lạ không gửi được). `requireJsonContentType` có **ngoại lệ đúng cặp method + path** (`PUT /me/avatar`, `POST /chat/uploads`) chỉ nhận `application/octet-stream`; route khác gửi octet-stream ⇒ 415 như cũ.
  - Middleware `rawUpload({maxBytes})`: `Content-Length` > trần ⇒ 413 ngay; chunked ⇒ đếm theo luồng, vượt ⇒ hủy + 413; **timeout** (B M7, F-08): không có byte nào 15 s ⇒ cắt, tổng 180 s ⇒ cắt; `aborted` ⇒ xóa tmp; ≤ **3 upload đồng thời / user** ⇒ thứ 4: 429. Proxy: Caddy `request_body max_size 21MB`. `X-Upload-Name` vào CORS `allowedHeaders` + pino redact.
- **Loại tệp theo nội dung**, không tin đuôi / `Content-Type`: hàm thuần `sniffType(head, extHint)` + `inspectZip(centralDirectory)`:
  - ảnh: JPEG, PNG, WebP, GIF (chỉ khung đầu). **Không** SVG, HEIC.
  - tài liệu: PDF; DOCX/XLSX/PPTX và ODT/ODS nhận diện bằng **central directory** (F-04, B M6) — tìm `[Content_Types].xml` (OOXML) hoặc `mimetype` (ODF), không theo thứ tự entry; trần **2 000 entry**, chỉ giải nén `[Content_Types].xml` / `mimetype` / `manifest.xml` với trần 1 MB. **Chặn** khi có `vbaProject.bin`, content-type chứa `macroEnabled`, thư mục `Basic/` hoặc `Scripts/` (ODF), `externalLink`, `oleObject`/`embeddings/*.bin` ⇒ 415 `MACRO_OR_ACTIVE_CONTENT`.
  - văn bản: TXT/CSV — UTF-8 (có/không BOM), UTF-16 LE/BE có BOM, **Windows-1258** khi không phải UTF-8 hợp lệ và không có NUL (F-05); lưu nguyên byte.
  - **Cấm:** HTML, SVG, XML, JS, tệp chạy được (MZ, ELF, Mach-O, `#!`), ZIP/RAR/7z/GZ thuần, video/âm thanh. Đuôi ≠ nội dung ⇒ 415 `UNSUPPORTED_FILE_TYPE`; `?as=image` mà không phải ảnh ⇒ 415.
- **Ảnh mã hóa lại bằng sharp** (B HIGH-2): bản 0.35.5 đã có trong lockfile (qua `next`); thêm vào `apps/api` **ghim chính xác**, bot cập nhật phụ thuộc theo dõi (A/B kiểm phiên bản + giấy phép trên npm trước khi thêm — TEAM luật 4; Apache-2.0, libvips LGPL-3.0 liên kết động).
  - Chạy trong **`worker_threads`** (pool 2 worker, `resourceLimits` ~256 MB / worker, timeout 10 s ⇒ giết worker + 422); đầu vào **chỉ Buffer** (đã nằm trọn trong trần 5/20 MB), không stream vào sharp.
  - Thứ tự: `sharp(buf, {limitInputPixels: 40e6, failOn: 'error', pages: 1}).metadata()` ⇒ `format` phải **khớp** kết quả `sniffType` (khác ⇒ 415) ⇒ mới biến đổi: `.rotate()` theo EXIF, **bỏ mọi metadata**, WebP q≈82. Avatar 256 + 64 px; ảnh chat `preview` ≤ 1 600 px + `thumb` ≤ 320 px; **không giữ bản gốc** ảnh gửi dạng ảnh. "Gửi dạng tệp" = lưu nguyên, chỉ tải xuống (UI cảnh báo vị trí trong ảnh).
  - Hàng đợi đầy (2 đang chạy + 4 chờ) ⇒ **503** `IMAGE_PROCESSING_BUSY` + `Retry-After: 5` (F-03b).
  - **Sức khỏe:** worker tự kiểm lúc khởi động (biến đổi ảnh 1 px) và mỗi 5 phút; gauge `files_image_worker_up`; lỗi ⇒ log `files.image_pipeline_unavailable` + cảnh báo. `/readyz` **không** phụ thuộc (app vẫn phục vụ). Không nạp được ⇒ avatar 503 `IMAGE_PROCESSING_UNAVAILABLE`, ảnh chat chỉ gửi dạng tệp.
- **URL ký** — mọi tệp qua API, không URL công khai, không thư mục static:
  - `GET /api/v1/media/<kind>/<id>/<variant>?v=<version>&exp=<unix>&sig=<hmac>`. Chữ ký trên **tuple chuẩn hóa** (B M3): `v1|<purpose>|<kind>|<id>|<variant>|<version>|<exp>` (`purpose ∈ {view, download}`; tệp chat `version = 1`). Tham số qua **zod trước** khi kiểm chữ ký; so sánh constant-time; sai / hết hạn ⇒ 404 **không chạm đĩa, không chạm DB** (F-10). `FILE_URL_SECRET` ≥ 32 byte, **khác** `JWT_ACCESS_SECRET` (env kiểm lúc khởi động); `FILE_URL_SECRET_PREVIOUS` cho xoay khóa (chỉ để kiểm, không để ký).
  - **Kiểm DB mỗi lần** sau chữ ký (B M4, F-03h): avatar còn đúng `version` và chủ còn thuộc công ty; đính kèm còn gắn tin **chưa xóa**, chưa hết retention ⇒ xóa tin = ảnh 404 ngay. Blob mất trên đĩa ⇒ 404 + log cảnh báo (F-09), không 500.
  - `exp` theo **khung**: avatar 24 giờ (URL sống 24–48 giờ), ảnh chat 1 giờ (1–2 giờ). Tệp không phải ảnh **không** ký sẵn: `POST /chat/attachments/:id/download-url` (Bearer, kiểm quyền lúc bấm) ⇒ `{url}` `purpose=download` hạn **60 s**; web `location.assign(url)` cùng tab (TL chốt — không `window.open` sau `await`, iOS chặn popup; không 302 qua fetch); `/media` trả `attachment` nên trang hiện tại không bị thay. Download **luôn** có `Content-Disposition: attachment; filename="<ASCII dự phòng>"; filename*=UTF-8''<percent-encoded>` (tên tiếng Việt). Lỗi ở `/media` (chữ ký hỏng / hết hạn / 403 / 404) trả **HTML tối giản** (cùng CSP sandbox) "Liên kết đã hết hạn hoặc không còn tồn tại" + link "Quay lại" — không JSON, vì người dùng đang ở trang điều hướng (E). v1 không có "Tải tất cả": mỗi lần một URL.
  - Header: `nosniff` · `Content-Security-Policy: default-src 'none'; sandbox` · `Referrer-Policy: no-referrer` · **CORP theo hosting** (B M2, F-06): web và API chung eTLD+1 (custom domain) ⇒ `same-site`; không ⇒ `cross-origin` **có chủ ý** (cấu hình `MEDIA_CORP`, smoke sau deploy kiểm theo `CORS_ORIGINS` thật). Ảnh: `image/webp`, `inline`, `Cache-Control: private, max-age=<giây còn lại của khung>` + `ETag` (E1 — không `immutable` vượt hạn URL). Tệp: `application/octet-stream`, `attachment; filename="<ascii>"; filename*=UTF-8''<đã làm sạch>`, `no-store`.
  - Log (B M5): pino-http và log Caddy **cắt toàn bộ query** của `/media`. Hạn mức IP nhẹ cho `/media` (600 / phút / IP — F-10). Web CSP `img-src` thêm origin API (E3).
- **Hạn mức:** avatar ≤ 5 MB; tệp ≤ 20 MB, ≤ 10 tệp / tin (11 ⇒ 422 `TOO_MANY_ATTACHMENTS`); mỗi người ≤ 200 MB / ngày, ≤ 30 lượt / 10 phút, ≤ 3 đồng thời; kho `FILE_STORE_MAX_BYTES` 50 GB ⇒ 507 `STORAGE_FULL` + cảnh báo; ổ < 10 % ⇒ cảnh báo. Bộ đếm dung lượng cập nhật **ngay** sau mỗi upload, đối soát lại mỗi 60 s. Hạn mức upload **fail-closed** khi Valkey lỗi (503 — khác R21 có chủ đích: upload tốn đĩa).
- **Không quét virus** (người dùng): bù bằng danh sách cho phép hẹp, chặn macro/nội dung chủ động, luôn `attachment` + `nosniff` + `sandbox`, ảnh mã hóa lại (R45). Thêm sau = port mới, không đổi luồng.
- **Dọn rác** `files-sweep` (mẫu T-033: mỗi giờ + jitter, advisory lock, theo lô, idempotent): upload chưa gắn > 24 giờ; blob không còn tham chiếu (đánh dấu, xóa sau 24 giờ); tmp > 1 giờ (lưới an toàn — đường chính xóa ngay). Xóa DB trước, đĩa sau commit.
- **Sao lưu tệp** (B HIGH-1): hằng ngày, **mã hóa** (restic, hoặc `tar | age` theo runbook hiện có), **khóa giải mã không nằm trên máy chủ**; đích tách khỏi máy chủ (ổ/máy khác hoặc kho backup đang dùng cho DB). Khôi phục: DB trước, tệp sau; tệp thiếu ⇒ 404 (F-09), tệp thừa ⇒ sweep. **Diễn tập khôi phục** hằng tháng cùng DB (runbook T-067).
- **Một instance** (v1): lên ≥ 2 instance ⇒ volume chung hoặc MinIO tự host (R47).
- **Cửa sổ chỉnh được ở test** (F-01/F-02, chỉ nhận khi `APP_ENV=test`, như `JWT_ACCESS_TTL_SECONDS`): `CHAT_EDIT_WINDOW_SECONDS`, `MEDIA_URL_AVATAR_BUCKET_SECONDS`, `MEDIA_URL_IMAGE_BUCKET_SECONDS`, `MEDIA_URL_DOWNLOAD_TTL_SECONDS`, `FILES_ORPHAN_TTL_SECONDS`, `UPLOAD_IDLE_TIMEOUT_MS`, `CHAT_UPLOAD_DAILY_BYTES`, `CHAT_SEND_HOURLY`, `FILE_STORE_USAGE_CACHE_MS`; `FILE_STORE_MAX_BYTES` vốn là env. Retention 12 tháng và avatar 30 ngày theo **đồng hồ nghiệp vụ** (`TEST_CLOCK_ANCHOR` + restart mốc tiến, như CLK-HR-06/09). Cửa sổ ngắn còn lại theo giờ thật.

**ADR-142 — Avatar.**
- `users.avatar_version INT NULL` (cột duy nhất thêm vào `users`); blob `avatars/<userId>/<version>/{256,64}`.
- `PUT /me/avatar` (octet-stream ≤ 5 MB) ⇒ sniff → worker sharp → 2 biến thể → transaction `avatar_version + 1` → sau commit xóa version cũ. Response `{avatarUrl}`. `DELETE /me/avatar` ⇒ `NULL`. 10 lần / giờ / user.
- **Gỡ avatar người khác (TL):** `DELETE /hr/employees/:userId/avatar` — `hr:manage`; avatar của Admin / người giữ grant chỉ Admin gỡ; không tự gỡ qua route này. Audit `hr_audit_logs` `AVATAR_REMOVED` (thêm giá trị vào tập action ở contracts, qua port audit sẵn có).
- **Event** `user:avatar-changed {userId, avatarUrl | null}` phát tới **mọi socket** (một công ty; mọi socket đã qua cổng công ty) ⇒ web invalidate mọi query key có `UserRefDto` (E1).
- **Ai thấy:** chỉ người đang thuộc công ty. **DTO:** `UserRefDto.avatarUrl?: string | null` (tùy chọn) — cập nhật ở `/auth/me`, task, thành viên ws + `member-candidates`, audit task, thông báo, chat; **để nguyên** DTO attendance/leave/hr/payroll (đội Mốc 4/5 thêm sau bằng `avatarUrlOf`).
- **Người đã nghỉ:** `avatarUrl = null` (chữ cái + tên); blob xóa sau 30 ngày (đồng hồ nghiệp vụ); nhận lại trong 30 ngày còn ảnh.

**ADR-143 — Mô hình hội thoại.**
- `kind ∈ {DIRECT, GROUP, WORKSPACE}`. "Thuộc công ty hoạt động" = có dòng `company_members`, `access_until > now`, **đã kích hoạt** (`password_hash` khác NULL).
- **DIRECT:** `direct_key = "<uuid nhỏ>:<uuid lớn>"` UNIQUE; `POST /chat/direct {userId}` tạo-hoặc-lấy (`ON CONFLICT DO NOTHING` rồi đọc). Chính mình ⇒ 422 `SELF_DIRECT`; người chờ kích hoạt / đã rời ⇒ 422 `RECIPIENT_INACTIVE` (F-03e); Admin nhắn và được nhắn bình thường. Người kia đã nghỉ ⇒ đọc lịch sử, không gửi. **Nhận lại** ⇒ DIRECT cũ hiện lại cho chính người đó (là hội thoại của họ — F-03g).
- **GROUP:** ai thuộc công ty cũng tạo (tên 1–80 ký tự, 2–99 người khác; 100 ⇒ 422 `GROUP_TOO_LARGE`); người tạo OWNER. OWNER: thêm/bớt, đổi tên, giao OWNER; thành viên: rời. Rời / bị bớt ⇒ `left_at`, **mất quyền đọc cả lịch sử**; thêm lại ⇒ thấy toàn bộ lịch sử.
  - **Nghỉ việc ⇒ rời mọi nhóm; nhận lại ⇒ không tự có lại** (F-03g) — **không cần hook** vào hoàn tất nghỉ việc: participant chỉ **hiệu lực** khi `left_at IS NULL` **và** `joined_at ≥ company_members.created_at` (dòng `company_members` chỉ được tạo lúc vào làm / nhận lại, bị xóa lúc hoàn tất nghỉ — `prisma-company.ts` / `prisma-company-offboarding.ts`). Người đã rời: không có dòng ⇒ không hiệu lực; nhận lại: dòng mới ⇒ participant cũ không hiệu lực; OWNER thêm lại ⇒ `joined_at` mới. Job `files-sweep` ghi `left_at` cho participant của người không còn dòng (chỉ để danh sách thành viên đúng). Nếu sau này nâng/hạ Admin tạo lại dòng `company_members` thì luật phải đổi — test CH-13 khóa giả định.
  - Không còn OWNER hiệu lực ⇒ `effectiveGroupOwners` coi người tham gia hiệu lực **sớm nhất** là OWNER; thao tác OWNER đầu tiên của người đó ghi `role = OWNER`.
- **WORKSPACE:** `workspace_id` UNIQUE, FK `Cascade` (purge ws xóa chat — R20); tạo **lười** (`PUT /chat/workspaces/:wsId/conversation`). **Thành viên = `workspace_members` hiện tại** của ws chưa xóa mềm / chưa lưu trữ, thuộc công ty hoạt động — **mọi role kể cả VIEWER đọc + gửi** (F-03d: chat không phải dữ liệu dự án). Tính lúc đọc/gửi, không bảng participant ⇒ không sửa use case workspace. Ws xóa mềm ⇒ 404 với mọi người; khôi phục ⇒ quay lại.
- **Đọc thành viên ws:** port `IWorkspaceChatAccess` (`isMember`, `memberIds`), adapter Prisma chỉ đọc (nếu dependency-cruiser buộc nằm ở workspace ⇒ một file mới, không sửa file cũ).
- **Danh bạ** `GET /chat/people?q=`: người thuộc công ty hoạt động (`ACTIVE`/`OFFBOARDING`; **không** chờ kích hoạt, không đã rời — F-03e); `id, fullName, avatarUrl`, **không** email; `q` 1–100, limit 20, 60 / phút. Là danh bạ tên nội bộ cho **mọi** nhân viên ⇒ R49 (B L4).

**ADR-144 — Tin nhắn.**
- Thân: NFC, trim, 1–4 000 code point (rỗng được nếu có đính kèm); văn bản thuần.
- **Idempotent:** `clientMsgId` (uuid) bắt buộc; UNIQUE `(sender_id, client_msg_id)` (bao hàm `(conversation, sender, clientMsgId)` của E6). Trùng + **cùng** hội thoại, thân, đính kèm ⇒ trả tin cũ 200, không phát event lần hai; trùng nhưng **khác** ⇒ 422 `IDEMPOTENCY_KEY_REUSED` (F-03a).
- Thứ tự `(created_at, id)`, `created_at` giờ thật (R31). Keyset `?before=<id>&limit=50`, `?after=<id>&limit=200` + `hasMore`.
- `replyToId` cùng hội thoại (khác ⇒ 422 `REPLY_OTHER_CONVERSATION`).
- **Sửa:** người gửi, ≤ 15 phút (`CHAT_EDIT_WINDOW_SECONDS` ở test) ⇒ `edited_at`; quá ⇒ 422 `EDIT_WINDOW_PASSED`. **Xóa:** người gửi ⇒ `deleted_at`, `body = NULL`, đính kèm tách khỏi tin cùng transaction (ảnh 404 ngay — ADR-141). Không ai khác xóa (TL chốt).
- **Đính kèm:** `POST /chat/uploads?as=image|file` ⇒ `{uploadId, kind, name, sizeBytes, width?, height?}`; `POST …/messages {clientMsgId, body?, replyToId?, attachmentIds[]}` — mỗi id là upload **của chính người gửi**, chưa gắn (khác ⇒ 404). DTO đính kèm có `width/height` (E8 — giữ chỗ khi cuộn).
- `sanitizeFileName`: NFC, bỏ ký tự điều khiển, `/\:*?"<>|`, bidi override (U+202A…202E, U+2066…2069), gộp khoảng trắng, giữ đuôi; chỉ để hiển thị + `filename*`, không bao giờ làm tên trên đĩa.
- Hạn mức: gửi 30 / phút + 600 / giờ; tạo nhóm 20 / ngày; sửa 30 / phút.

**ADR-145 — Realtime và chưa đọc.**
- **Phát tới `user:{id}`** từng người nhận (`io.to([...])` một lần): participant hiệu lực (DIRECT/GROUP) hoặc thành viên ws (WORKSPACE), **lọc công ty hoạt động** trong cùng truy vấn. Không phòng theo hội thoại, không `chat:join`. Người hết `access_until` không nhận tin chat kể cả trong khe R40.
- Event (vỏ `RealtimeEnvelope`, sau commit): `chat:message:new` (tin đầy đủ, kèm `clientMsgId` cho người gửi khử trùng — E6), `chat:message:updated`, `chat:read {conversationId, userId, messageId}` (thiết bị khác của mình; DIRECT: cả người kia — "Đã xem"), `chat:conversation:updated`, `chat:conversation:removed`, `chat:typing`, `user:avatar-changed`.
- **Đang gõ:** `chat:typing {conversationId}` ≤ 1 / 3 s / socket; kiểm quyền với cache theo socket **≤ 5 s** (B L1, F-03i) ⇒ người vừa bị bớt còn phát/nhận typing tối đa 5 s (ghi trong SEC-CH-04).
- **Bù khi nối lại:** `GET /chat/conversations` + `GET …/messages?after=`; web gộp theo `id`.
- **Chưa đọc:** `chat_read_states` (cả 3 loại, tạo lười); `PUT …/read {messageId}` chỉ tiến; đếm tin sau con trỏ, không phải của mình, chưa xóa, trần 99; tổng header bỏ hội thoại tắt tiếng.
- Không `notifications`, không email/push.

**ADR-146 — Quyền và quyền riêng tư.**
- Router `/chat/*`, `/me/avatar`: cổng công ty `loadCompanyMember` (ADR-135) ⇒ 401 `SESSION_REVOKED`. Thứ tự lỗi 401 → 403 → 400 → **404 khi không phải người tham gia** → 422/409. `/media`: chỉ chữ ký + kiểm DB (ADR-141).
- **Admin và HR không có quyền ngầm** đọc, liệt kê, xuất, xóa trò chuyện của người khác; không route quản trị chat; "Báo cáo tin nhắn" để sau v1 (TL chốt).
- Nghỉ việc: mất mọi quyền chat, rời mọi nhóm (ADR-143), tin cũ còn, tên giữ, avatar về chữ cái. Rời ws ⇒ mất phòng ws ngay.
- XSS: thân tin là text node; tự nhận link chỉ `http(s)://`, `rel="noopener noreferrer nofollow" target="_blank"`; tên tệp/nhóm/người là text.

**ADR-147 — Lưu giữ (R27, NĐ 13/2023).**
- D12 tin + tệp chat, D13 avatar, D14 metadata tệp. **12 tháng** kể từ `created_at` (người dùng; `CHAT_RETENTION_DAYS=365`, đồng hồ nghiệp vụ); tin xóa: thân NULL ngay, blob ≤ 1 giờ; avatar: tự xóa / bị gỡ / rời + 30 ngày; upload mồ côi 24 giờ. Job `chat-retention` hằng ngày theo `data-retention.md` §4. Purge ws cascade.
- Dữ liệu đã xóa còn trong backup tới hết tầng giữ (R48).
- **Yêu cầu của chủ thể** (xem / xóa — B M8): v1 xử lý **thủ công** qua đầu mối trong thông báo (người vận hành truy vấn theo `sender_id`, có biên bản); không có nút tự phục vụ. Thông báo xử lý dữ liệu thêm đoạn "Trò chuyện & ảnh đại diện" (B, T-074): 12 tháng, không mã hóa đầu-cuối, Admin/HR không đọc qua app, người vận hành hạ tầng về kỹ thuật đọc được.

**ADR-148 — Migration, phân đội, quy tắc song song.**
- Một migration `avatar_chat`: 3 enum, 5 bảng mới (§3), `users.avatar_version`. **Timestamp thư mục đặt lúc merge**; "migration 6…9" của Mốc 4/5 là nhãn, không là thứ tự.
- Code mới: `modules/chat`, `core/files`; web `entities/chat`, `features/chat-*`, `features/avatar-*`, `widgets/chat-*`, `views/chat`. **File chung phải sửa** (TL gộp khi merge): `schema.prisma` (khối "Mốc 6" cuối file + 3 dòng relation ở `User`), composition root, `app.ts`, `core/http/middleware.ts` (CORS header + ngoại lệ content-type), `core/realtime/events.ts`, `packages/contracts` (`UserRefDto`, `chat/`), web `app-header` (thứ tự mục ☰ chốt **một lần** với đội Mốc 4 — E12), `shared/api/http` (nhánh body nhị phân), `shared/ui/avatar` (prop `src`), `csp.ts`, Sentry web (scrub `sig`), trang `/hr/employees` (dialog gỡ avatar ở **cấp trang**, không trong widget HR — E12), `security.md`, `devops.md`, `security-go-live.md`.
- Nhánh tích hợp `feat/avatar-chat` từ `main`; verify gộp một lượt; rebase khi Mốc 4/5 merge.

## 3. Dữ liệu — migration `avatar_chat`

```
users                + avatar_version INT NULL                        -- CHECK (avatar_version IS NULL OR avatar_version > 0)
chat_conversations   id uuid PK · kind · title varchar(80) NULL · direct_key varchar(73) NULL UNIQUE
                     · workspace_id uuid NULL UNIQUE FK workspaces Cascade · created_by_id FK users Restrict
                     · last_message_at timestamptz NULL · last_message_id uuid NULL · created_at · updated_at
                     CHECK: DIRECT ⇔ direct_key NOT NULL; WORKSPACE ⇔ workspace_id NOT NULL; GROUP ⇔ title NOT NULL
chat_participants    (conversation_id FK Cascade, user_id FK Restrict) PK · role · joined_at · left_at NULL
                     INDEX (user_id, left_at)                          -- chỉ DIRECT/GROUP (use case + CH-10)
chat_read_states     (conversation_id FK Cascade, user_id FK Restrict) PK · last_read_message_id uuid NULL · muted bool · updated_at
chat_messages        id uuid PK · conversation_id FK Cascade · sender_id FK Restrict · client_msg_id uuid · request_hash char(64)
                     · body text NULL (CHECK char_length ≤ 4000) · reply_to_id uuid NULL FK chat_messages SetNull
                     · created_at · edited_at NULL · deleted_at NULL
                     UNIQUE (sender_id, client_msg_id) · INDEX (conversation_id, created_at, id) · INDEX (created_at)
chat_attachments     id uuid PK · uploader_id FK Restrict · message_id uuid NULL FK chat_messages SetNull
                     · kind {IMAGE, FILE} · original_name varchar(255) · mime varchar(100) · size_bytes int · sha256 char(64)
                     · width int NULL · height int NULL · file_key · preview_key NULL · thumb_key NULL · created_at
                     INDEX (message_id) · partial INDEX (created_at) WHERE message_id IS NULL · INDEX (uploader_id, created_at)
```
- `request_hash` = SHA-256 của (conversation, thân chuẩn hóa, attachmentIds sắp xếp) để phân biệt trùng-giống / trùng-khác (ADR-144).
- `last_message_*` cập nhật trong transaction gửi. Seed (chặn production): DIRECT Mia↔Vic, nhóm "Dự án Sao Mai", phòng ws mẫu, ảnh mẫu sinh bằng sharp lúc seed.

## 4. API (`/api/v1/…`, contracts Zod `.strict()` + OpenAPI)

| Route | Ai | Ghi chú |
|---|---|---|
| `PUT/DELETE me/avatar` | chính mình | octet-stream ≤ 5 MB |
| `DELETE hr/employees/:userId/avatar` | `hr:manage` (Admin cho Admin/người có grant) | audit `AVATAR_REMOVED` |
| `GET chat/people?q` | thuộc công ty | không email, không người chờ kích hoạt |
| `GET chat/conversations?cursor` · `GET chat/unread-count` | thuộc công ty | keyset `last_message_at desc, id`; `unread`, `muted`, `canSend` |
| `POST chat/direct {userId}` · `POST chat/groups {title, memberIds}` · `PUT chat/workspaces/:wsId/conversation` | thuộc công ty / thành viên ws | tạo-hoặc-lấy |
| `GET/PATCH chat/conversations/:id` · `POST/DELETE …/members[/:userId]` · `PUT …/owner` · `POST …/leave` | người tham gia / OWNER | chỉ GROUP (khác ⇒ 422 `NOT_GROUP`) |
| `GET/POST …/:id/messages` · `PATCH/DELETE chat/messages/:id` · `PUT …/read` · `PUT …/mute` | người tham gia / người gửi | |
| `POST chat/uploads?as=image\|file` · `POST chat/attachments/:id/download-url` | thuộc công ty / người tham gia | URL tải 60 s |
| `GET media/avatars/:userId/:variant` · `GET media/chat/:attachmentId/:variant` | chữ ký + DB | không Bearer |

Lỗi mới: 400 `INVALID_UPLOAD_NAME`; 413 `PAYLOAD_TOO_LARGE`; 415 `UNSUPPORTED_FILE_TYPE` / `MACRO_OR_ACTIVE_CONTENT`; 422 `SELF_DIRECT` / `RECIPIENT_INACTIVE` / `NOT_ACTIVE_MEMBER` / `NOT_GROUP` / `EDIT_WINDOW_PASSED` / `REPLY_OTHER_CONVERSATION` / `GROUP_TOO_LARGE` / `TOO_MANY_ATTACHMENTS` / `IDEMPOTENCY_KEY_REUSED`; 429; 503 `IMAGE_PROCESSING_BUSY` (+ `Retry-After`) / `IMAGE_PROCESSING_UNAVAILABLE`; 507 `STORAGE_FULL`.

## 5. Bảo mật — ca SEC (B rà, T-074; F soát)

| ID | Kịch bản | Mong đợi |
|---|---|---|
| SEC-CH-01 | IDOR: Otto đọc/gửi/đọc-đánh-dấu/sửa/xóa ở DIRECT Mia↔Vic | 404; DB không đổi |
| SEC-CH-02 | Otto gắn upload của Mia; xin `download-url` tệp ở nhóm mình không thuộc | 404 |
| SEC-CH-03 | Ada (Admin), Hana (HR) gọi mọi route chat với hội thoại của người khác / phòng ws không là thành viên | 404 |
| SEC-CH-04 | Ba vế (F): bị bớt khỏi ws; rời / bị bớt khỏi nhóm; nghỉ việc — CÙNG token đọc / gửi / typing; socket mở sẵn | 404 / 401; không nhận `chat:message:new` kế tiếp; typing tối đa 5 s |
| SEC-CH-05 | Hết `access_until`, job phút chưa chạy (mẫu `company-clock-0559`) | 401 REST; socket không nhận event chat |
| SEC-CH-06 | `evil.html`, SVG `<script>`, PNG đuôi `.exe`, EXE đuôi `.pdf`, ZIP/RAR/7z thuần, polyglot GIF+JS | 415; polyglot ⇒ mã hóa lại, đầu ra không chứa payload |
| SEC-CH-07 | JPEG có EXIF GPS gửi dạng ảnh + làm avatar | biến thể không còn EXIF/GPS |
| SEC-CH-08 | Pixel bomb 50 000², tệp 21 MB, chunked 25 MB, avatar 6 MB | 413/422 ≤ 2 s; không sót `tmp/` (bỏ vế đo RAM — F) |
| SEC-CH-09 | `X-Upload-Name`: `../../etc/passwd`, U+202E, NUL, thiếu, hỏng, 256 byte | tên lạ ⇒ khóa server + `filename*` sạch, không ghi ngoài kho; thiếu/hỏng/256 byte ⇒ 400 |
| SEC-CH-10 | Header phục vụ: ảnh, PDF, TXT chứa HTML | `nosniff`, `sandbox`, CORP đúng cấu hình, `attachment` + `octet-stream` cho không-ảnh |
| SEC-CH-11 | URL ký: sửa `exp`/`sig`/path/`v`, URL hết hạn, `download-url` sau 61 s | 404 như nhau, body HTML tối giản (không JSON, không lộ lý do) |
| SEC-CH-12 | Upload `multipart/form-data` / `text/plain` không Bearer | 415 / 401, không ghi |
| SEC-CH-13 | XSS: thân `<img onerror>`, `javascript:`, tên nhóm/tệp chứa HTML | nguyên văn; không link `javascript:` |
| SEC-CH-14 | 31 tin / phút; 31 upload / 10 phút; vượt `CHAT_UPLOAD_DAILY_BYTES` (2 MB ở test); `STORAGE_FULL` với kho nhỏ | 429 / 507; không ghi |
| SEC-CH-15 | GROUP: thành viên thường quản trị nhóm; thêm người đã rời / chờ kích hoạt / id lạ | 403; 422 `NOT_ACTIVE_MEMBER`; 404 |
| SEC-CH-16 | Sửa/xóa tin người khác; sửa quá cửa sổ (test 2 s); sửa tin đã xóa | 404; 422; 404 |
| SEC-CH-17 | Gỡ avatar: Mia→Vic; Hana→Ada / Kay (grant) / chính mình; Ada→Hana | 403 ×3; 204 + audit |
| SEC-CH-18 | `chat/people` | không email, không người đã rời / chờ kích hoạt |
| SEC-CH-19 | `chat:typing` hội thoại không thuộc; 10 / giây | không ai nhận; bỏ qua ngoài 1 / 3 s |
| SEC-CH-20 | Log API, log proxy, Sentry API + web (event **và breadcrumb**) | không thân tin, tên tệp, query `/media`, `sig` (B M8, F-11) |
| SEC-CH-21 | (B) Ảnh có magic PNG nhưng `metadata().format` khác / hỏng giữa tệp | 415 / 422; không biến thể nào được ghi |
| SEC-CH-22 | (B) Octet-stream gửi tới route khác `PUT me/avatar`, `POST chat/uploads`; đúng path sai method | 415 |
| SEC-CH-23 | (B) Đổi `purpose`/`kind`/`variant`/`version` giữ nguyên `sig`; ký bằng `_PREVIOUS` trong lúc xoay; secret < 32 byte hoặc = JWT | 404; 200; từ chối khởi động |
| SEC-CH-24 | (B) Office có `vbaProject.bin`, `macroEnabled`, `externalLink`, `oleObject`, ODF `Basic/`, > 2 000 entry; `.docm` đổi đuôi `.docx` | 415 |
| SEC-CH-25 | (B) Upload thứ 4 đồng thời; ổ trống < trần; Valkey hạn mức lỗi | 429; 507 trước khi tạo tmp; 503 (fail-closed) |
| SEC-CH-26 | (F-08) Hủy kết nối ở 50 % | ≤ 2 s không còn tệp trong `tmp/` |
| SEC-CH-27 | (F-08) Drip 1 KB/s | cắt sau `UPLOAD_IDLE_TIMEOUT_MS` / tổng, không sót tmp |
| SEC-CH-28 | (F-03g) Nghỉ việc rồi nhận lại | không thấy nhóm cũ; DIRECT cũ hiện lại; OWNER thêm lại ⇒ thấy |
| SEC-CH-29 | (F-03h) Xóa tin rồi mở URL ảnh đã ký | 404 ngay |
| SEC-CH-30 | (F) Ws xóa mềm ⇒ phòng 404 mọi người; khôi phục ⇒ quay lại; purge ⇒ cascade + blob bị sweep (đếm tệp trong kho) | đúng |
| SEC-CH-31 | (F-09/F-10) Blob bị xóa tay ⇒ tải; 601 request `/media` / phút / IP; chữ ký sai không chạm đĩa | 404 không 500; 429; — |
| SEC-CH-32 | (F-04/F-05) DOCX/XLSX từ Word, LibreOffice, Google Docs, WPS; CSV UTF-16 BOM / Windows-1258 | 201 |

## 6. Test (F: `test-spec-chat.md` + harness + soát cuối; G/H viết ca theo module — T-073)

- **Harness (F chốt với TL):** `upload(api, token, buf, {name, as, chunked?, abortAt?, dripBps?})`; tệp mẫu **sinh lúc chạy** (sharp / byte tay / ZIP STORED tự dựng — không commit nhị phân; bộ Office thật 4 công cụ lưu ngoài repo); `FILE_STORE_DIR` riêng mỗi file suite, `FILE_URL_SECRET` hằng test; tầng S **được đọc cây thư mục kho** (quan sát hạ tầng như `api.logs()`); seed 100 000 tin / phòng 300 người bằng **script DB chỉ ở tầng P** (ngoại lệ ADR-140). Ca tệp lớn gom `chat-upload-limits.sec.ts`, xin lượt TL một lần.
- **AV-\***: AV-01 version đơn điệu + xóa version cũ sau commit; AV-02 256/64 WebP không metadata; AV-03 khung URL; AV-04 người rời ⇒ `null`; AV-05 sweep 30 ngày (đồng hồ nghiệp vụ), giữ người nhận lại; AV-06 worker không nạp ⇒ 503, app chạy; AV-07 `user:avatar-changed` tới socket khác.
- **CH-\***: CH-01 `directKey`; CH-02 `effectiveGroupOwners` (gồm OWNER nghỉ rồi nhận lại); CH-03 `sniffType` + `inspectZip` (central directory, ODF, macro, entry cap, UTF-16/1258); CH-04 `sanitizeFileName`; CH-05 thân 4 000/4 001 code point; CH-06 con trỏ đọc chỉ tiến; CH-07 trần 99; CH-08 keyset cùng `created_at`; CH-09 `verifyMediaSig` (tuple, `_PREVIOUS`, biên hết hạn); CH-10 phòng ws tính lúc đọc, VIEWER gửi được; CH-11 retention 12 tháng biên ±1 ngày; CH-12 sweep không xóa upload < TTL; CH-13 participant hiệu lực theo `company_members.created_at` (giả định dòng chỉ tạo lúc vào làm / nhận lại); CH-14 `rename` thử lại EPERM (fs giả); CH-15 `request_hash` trùng-giống / trùng-khác; CH-16 `GROUP_TOO_LARGE` ở 100.
- **CC-CH-\*** (×20): 01 cùng `clientMsgId` ×5 ⇒ 1 dòng, 1 event; 02 hai bên cùng `POST chat/direct`; 03 OWNER rời ‖ bớt người; 04 2 `PUT me/avatar`; 05 `PUT read` lệch thứ tự; 06 gắn cùng upload vào 2 tin; 07 xóa tin ‖ sweep ‖ tải; 08 gắn upload ‖ sweep ở biên TTL; 09 3 upload ảnh khi pool 2 + hàng chờ ⇒ 503 có `Retry-After`.
- **E2E-CH-\*** (360 px + desktop): 01 avatar cắt + tải ⇒ header, board, thành viên; 02 Mia→Vic 2 tab, badge, đọc ⇒ 0 (kéo > 10 s để qua `auth:renew`); 03 nhóm, kéo-thả (`DataTransfer`), dán (`@chromium-only`), xem ảnh, PDF tải về (`waitForEvent('download')` + SHA-256); 04 phòng ws từ trang ws, bị bớt ⇒ biến mất; 05 mất mạng → gửi → nối lại ⇒ không trùng; 06 cuộn ngược giữ vị trí; 07 axe + vùng `aria-live`. Tìm người theo `q` duy nhất mỗi ca (một công ty).
- **Hiệu năng** (tầng P, máy rảnh): `GET messages` p95 ≤ 150 ms ở 100 000 tin; danh sách 50 hội thoại p95 ≤ 200 ms; gửi → event p95 ≤ 300 ms; phòng 300 người một `io.to()`; upload 20 MB không chặn event loop > 50 ms (worker).
- **Stryker** (máy rảnh): `chat/domain` + `core/files/domain` (+ phần đếm byte thuần của `rawUpload`) ≥ 90 %.
- **Thủ công trên máy thật (H, checklist trước deploy):** HEIC / ảnh từ iPhone + Android; tải tệp (tên tiếng Việt) từ Safari/Chrome, từ **PWA standalone**, và từ trình duyệt trong **Zalo / Messenger**; URL hết hạn hiện trang lỗi có "Quay lại".

## 7. Web (H — theo E)

- **Header** (E9): ≥ md icon "Trò chuyện" cạnh chuông, badge `9+`, `aria-label="Trò chuyện, N tin chưa đọc"`; < md mục "Trò chuyện" trong ☰ + chấm badge trên ☰ + ô "Trò chuyện" ở trang chính `/w`. Trang ws: link ⇒ `/chat/ws/[wsId]`.
- `/chat` + `/chat/[id]`: < md hai màn toàn màn hình; ≥ md hai cột. "Tin nhắn mới", "Tạo nhóm" (combobox `chat/people`).
- **Luồng tin** (E8): cuộn ngược bù `scrollHeight` khi chèn trang cũ; giữ chỗ ảnh bằng `width/height`; mark-read khi tab **visible** + `IntersectionObserver` tin cuối, debounce 1 s; vạch "Tin chưa đọc"; reply, sửa/xóa; "Đã xem" ở DIRECT. Ảnh chat `onError` ⇒ invalidate trang chứa tin **một lần / id** (URL hết khung) (E1).
- **Composer** (E10): Enter gửi **bỏ qua khi `isComposing`** (Telex/VNI); `pointer: coarse` ⇒ Enter xuống dòng + nút Gửi; dán/kéo-thả; typing throttle ≥ 3 s. Gửi lạc quan với `clientMsgId`, khử trùng echo đến **trước** response (E6), catch-up gộp theo `id`. Nháp chỉ trong state (E11).
- **Upload** (E2): nhánh body nhị phân trong `shared/api/http`; upload dùng **XHR riêng** có tiến độ % + hủy; `X-Upload-Name: encodeURIComponent(name)`; kiểm 20 MB / loại phía client trước. `URL.revokeObjectURL` mọi preview (E11). Tải tệp: `POST download-url` ⇒ `location.assign(url)` **ngay** khi nhận `{url}` (không xếp hàng, không gom nhiều tệp — TL chốt); luồng tải **không** dựa vào `pagehide` / `beforeunload`.
- **Avatar** (E1/E4/E5): `shared/ui/avatar` prop `src` (`onError` ⇒ chữ cái); cropper tự viết: Pointer Events, slider zoom **và** phím mũi tên (WCAG 2.5.7), `createImageBitmap(file, {imageOrientation: 'from-image', resizeWidth})`, xuất 512 px JPEG 0.85 nền trắng. `accept="image/jpeg,image/png,image/webp"` (MIME cụ thể, không `capture`); lỗi bằng lời thường ("Ảnh này chưa đọc được, hãy chọn ảnh JPG hoặc PNG"). `/account` "Ảnh đại diện"; `/hr/employees` nút "Gỡ ảnh đại diện" mở dialog ở **cấp trang**.
- **Realtime:** `features/chat-realtime` vá cache `['chat', …]`; `user:avatar-changed` ⇒ invalidate key có `UserRefDto`; xóa cache khi đăng xuất / `SESSION_REVOKED`.
- **a11y** (E8): vùng `sr-only` `aria-live="polite"` **riêng**, chỉ đọc tin **đến** ("Vic: …"), không đọc lịch sử; nút có nhãn; focus về composer sau gửi.
- **Selector cho F** (E13): ưu tiên role + nhãn — `link "Trò chuyện"`, `log "Tin nhắn"`, `textbox "Soạn tin"`, `button "Gửi"`, `button "Đính kèm"`, `dialog "Xem ảnh"`, `button "Tải xuống <tên>"`, `slider "Thu phóng"`, `button "Lưu ảnh đại diện"`; `data-testid` chỉ cho `chat-message-<id>`, `upload-chip-<n>`.
- MSW handler từ contracts ⇒ H làm trước khi G xong.

## 8. Rủi ro mới (B ghi `threat-model.md` §6)

| # | Rủi ro | Vì sao chấp nhận | Xem lại khi |
|---|---|---|---|
| R43 | URL media ký là bearer: lộ URL ⇒ người ngoài xem tới hết khung (avatar ≤ 48 giờ, ảnh chat ≤ 2 giờ, tệp ≤ 60 s) | `<img>` không gửi Bearer; URL chỉ phát cho người có quyền; kiểm DB mỗi lần (xóa ⇒ 404 ngay); `no-referrer`; query cắt khỏi log/Sentry | Có ảnh nhạy cảm; hoặc chuyển cookie media cùng site |
| R44 | Người mất quyền (bị bớt, rời ws, nghỉ việc) vẫn mở được URL ảnh chat **đã nhận** ≤ 2 giờ (DB không biết người xem) | Họ đã xem được lúc còn quyền; tệp không phải ảnh cần `download-url` mới | Như R43 |
| R45 | Không quét virus (người dùng); CSV/XLSX có thể chứa công thức nguy hiểm khi mở bằng Excel (B L3) | Danh sách cho phép hẹp, cấm nén/chạy được, chặn macro + externalLink/OLE theo nội dung, luôn `attachment`; Excel tự cảnh báo liên kết ngoài | Cho phép tệp nén, hoặc có sự cố |
| R46 | Tin nhắn không mã hóa đầu-cuối: người có quyền DB, backup, ổ tệp, **Valkey pub/sub** (redis-adapter mang thân tin khi > 1 instance) đọc được (B M8) | Công cụ nội bộ; Admin/HR không có đường app; thông báo nhân viên | Yêu cầu bảo mật cao hơn |
| R47 | Kho trên ổ một máy: hỏng ổ ⇒ mất tệp từ lần backup cuối; không scale ngang | Người dùng chọn tự lưu; backup mã hóa hằng ngày + diễn tập | ≥ 2 instance ⇒ volume chung / MinIO |
| R48 | Dữ liệu đã xóa còn trong backup tới hết tầng giữ | Như DB | Yêu cầu xóa ngay |
| R49 | `chat/people` là **danh bạ tên + ảnh** của cả công ty cho **mọi** nhân viên (mở rộng R41, B L4) | Cần để nhắn tin / tạo nhóm; không email; không người chờ kích hoạt / đã rời; 60 / phút | Có người ngoài công ty (khách) dùng app |

## 9. Chia việc và thứ tự

| Vé | Ai | Nội dung | Phụ thuộc | Ước tính |
|---|---|---|---|---|
| T-067 | G | `core/files`: port + `LocalFileStore` (tmp/rename thử lại, ổ trống, khóa regex), `rawUpload` (timeout, abort, ≤ 3 đồng thời), ngoại lệ content-type, `sniffType` + `inspectZip`, `sanitizeFileName`, ký/kiểm tuple + `_PREVIOUS`, worker sharp (pool, `resourceLimits`, health, 503), `/media` (DB check, CORP, cắt query, hạn mức IP), hạn mức fail-closed, `STORAGE_FULL`, `files-sweep`, env test-only, volume compose, metrics; runbook backup tệp + diễn tập | — **(đầu tiên)** | 3,5 ngày |
| T-068 | G | Migration `avatar_chat`; avatar (`me/avatar`, gỡ + audit, `avatarUrlOf`, `UserRefDto` ở auth/task/workspace/notifications, `user:avatar-changed`) | T-067 | 1,5 ngày |
| T-069 | G | Module `chat`: domain thuần, contracts, 3 loại hội thoại, participant hiệu lực theo `company_members.created_at`, `IWorkspaceChatAccess`, tin (keyset, `request_hash`, sửa/xóa, reply), upload + gắn, `download-url`, read/mute/unread, `chat/people`, hạn mức, `chat-retention`, seed | T-068 | 3,5 ngày |
| T-070 | G | Realtime: phát `user:` lọc công ty, event, `chat:typing` (cache ≤ 5 s), test I 2 socket / 2 tab | T-069 | 1 ngày |
| T-071 | H | Avatar `src` mọi nơi, cropper (Pointer + phím), `/account`, dialog gỡ ở `/hr/employees`, CSP, nhánh nhị phân `http` + XHR upload | contracts T-068; MSW trước | 2 ngày |
| T-072 | H | Chat UI §7 | contracts T-069; MSW; realtime sau T-070 | 4,5 ngày |
| T-073 | F (+G, H) | `test-spec-chat.md` + kiểm kê mã ca theo file ngay khi viết, harness nhị phân, soát cuối, E2E, clock-window, Stryker (F ≈ 4 ngày); ca SEC/CC theo module chia **từ đầu**: G viết SEC-CH-06…12, 21…27, 29, 31, CC-CH-04/07/08/09 (≈ 1,5 ngày), H viết E2E-CH-01/07 (≈ 0,5 ngày) | song song; S/C sau T-069/T-070; E2E sau T-072 | ≈ 6 ngày tổng |
| T-074 | B | Review T-067 + T-069; `threat-model.md` R43–R49; `data-retention.md` D12–D14 + đoạn thông báo + quy trình yêu cầu thủ công; `security.md` (upload, W-CSP-2, ngoại lệ content-type); `devops.md` §1.3 đổi ứng viên mặc định (ổ lâu dài); `security-go-live.md` mục chốt hosting + CORP + backup tệp | review theo vé | 1,5 ngày |
| — | TL | `DECISIONS.md` ADR-141…148 sau duyệt; `feat/avatar-chat`; gộp file chung; chốt thứ tự mục ☰ với đội Mốc 4 | sau duyệt | 0,5 ngày |

Thứ tự: **T-067 → T-068 → T-069 → T-070**; H bắt đầu từ contracts + MSW; F viết spec + harness từ ngày 1. **Đường găng G ≈ 11 ngày** (9,5 code + 1,5 ca test); H ≈ 7 ngày song song; tổng lịch ≈ **12–13 ngày làm việc** + verify gộp, tùy tải máy (ADR-107). Việc nặng (upload lớn, sharp trong Docker build, Playwright, Stryker) xếp lượt với Mốc 4/5.

## 10. Đã chốt (người dùng 17/10 + TL)

1. **Hosting:** người dùng "chưa biết" ⇒ TL chốt thiết kế cho máy có ổ lâu dài (VPS hoặc máy văn phòng, Compose + volume), adapter đổi được; backup tệp mã hóa, khóa tách khỏi máy chủ, diễn tập khôi phục; **người dùng chốt hosting trước deploy** (checklist go-live) — ADR-141, R47.
2. **Lưu tin + tệp 12 tháng** — ADR-147.
3. **Không quét virus**, cấm tệp nén / chạy được, chặn macro theo nội dung — ADR-141, R45.
4. **Giữ giới hạn** 5 MB / 20 MB / 10 tệp / 50 GB — ADR-141.
5. **Kiểm duyệt (TL chốt):** v1 không ai đọc/xóa tin người khác; nút "Báo cáo" để sau — ADR-146.

Câu hỏi còn mở cho người dùng: **chỉ** chọn hosting trước deploy (mục 1). R27 Q2/Q4/Q5 vẫn mở như trước.
