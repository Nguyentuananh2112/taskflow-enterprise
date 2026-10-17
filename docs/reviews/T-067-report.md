# T-067 — Kho tệp (`core/files`) — báo cáo (Engineer G)

> Trạng thái: **ĐANG LÀM** (bước 1–2 xong, bước 3–9 chưa). Nhánh `feat/T-067` từ `feat/avatar-chat`.
> Căn cứ: `docs/design/avatar-chat.md` v2.1 (ADR-141), `test-spec-chat.md` (F, §1.2 / §2).

## Lệch so với ADR-141 (TL đồng ý 18/10 — TL cập nhật ADR-141 lúc gộp)

1. **Port hai pha.** `IFileStore` có thêm `stage(data, {maxBytes}) → StagedFile`. Upload được ghi vào `tmp/`,
   đếm byte, tính SHA-256 và giữ 64 KiB đầu. `sniffType` / `inspectZip` / sharp chạy trên **bản tạm**,
   rồi mới `commit(key?)` (rename vào chỗ) hoặc `discard()`. Nhờ vậy blob chỉ hiện ra trong kho sau khi
   nội dung đã qua kiểm tra. `put` = `stage` + `commit`. `open(key)` trả `{stream, sizeBytes}` (cần cho
   `Content-Length`). Thêm `purgeStaleTemp(before)` cho `files-sweep`.
2. **Khóa avatar xác định** `avatars/<uuid>/<version>/<256|64>`, vì ADR-142 chỉ có cột `avatar_version`,
   không có cột key. Cả hai dạng khóa (ngẫu nhiên `^[a-z2-7]{26}$` và avatar) đều được regex kiểm
   **trước mọi thao tác đĩa**, kể cả `commit`: khóa sai ⇒ `RangeError` và tmp vẫn bị xóa. Khóa avatar chỉ
   dựng bằng `avatarFileKey(userId, version, variant)` từ dữ liệu server (userId của phiên, version từ DB),
   không bao giờ từ input thô của client (điều kiện của TL; B soát).
3. **Ảnh hỏng** ⇒ 422 `BUSINESS_RULE_VIOLATION` `details.rule = IMAGE_UNREADABLE`; **sharp quá thời gian /
   vượt trần điểm ảnh** ⇒ `IMAGE_TOO_COMPLEX` (TL 18/10). Cả hai trong `BusinessRule` của contracts; test parity
   `test/contract/files-parity.test.ts`.

Khác (đã thống nhất với F): env chỉ cho `APP_ENV=test` là `FILES_SWEEP_ON_START`, `FILES_SWEEP_INTERVAL_MS`
(≥ 1 s), `FILES_IMAGE_PIPELINE_DISABLED`. `MEDIA_CORP` là env thường.

## Đã làm

| Bước | Commit | Nội dung |
|---|---|---|
| 1 | 52cee43 | `core/files/domain`: `sniffType`, `inspectZip` (central directory, trần 2 000 entry, bung ≤ 1 MB, chặn macro / externalLink / OLE / ActiveX / ODF `Basic/` `Scripts/`), `detectTextEncoding` (UTF-8 ± BOM, UTF-16 BOM, Windows-1258), `decodeUploadName`, `sanitizeFileName`, `attachmentDisposition`, `file-key`, `media-signature` (tuple v1, `_PREVIOUS`, `bucketExpiry`) |
| 2 | cccdbe8 | `ports.ts` + `LocalFileStore` / `LocalStagedFile`; 6 ErrorCode mới + lớp lỗi |
| — | 50b3200 | CH-03 đối chiếu fixtures của F (48 ca) |
| — | 6c70353 | rule `IMAGE_UNREADABLE` + parity |
| — | 913812e, be78af2 | soát B: commit không ghi đè, tmp 1 giờ, realpath, probe hard link |
| — | 346716f | rule `IMAGE_TOO_COMPLEX` |
| — | 7bed90e7 | contract avatar sớm (phần contract của T-068) + `PENDING_SERVER_EMIT` |
| — | b37ff159 | `X-Upload-Name` trong CORS + test preflight |
| 3 | edc564ae, 68c44f70 | `rawUpload` + ngoại lệ content-type đúng cặp method + path + `UploadSlots` (+ soát B L1–L3) |
| — | 5be35027 | sharp 0.35.5 + `THIRD_PARTY_NOTICES.md` |
| — | f5c94890 | `avatarUrl` ở `MemberDto` / `MemberCandidateDto` (H) |
| 4 | 79e09153 | `IImagePipeline` + `SharpImagePipeline` (pool worker sharp) + `DisabledImagePipeline` |
| — | 265d08c4, 8d310b3e | contract chat sớm (phần contract của T-069) + parity realtime `PENDING_SERVER_EMIT` (T-070) |
| 5 | (commit này) | `/media` (`mediaRouter`) + `MediaUrlSigner` + port `IMediaResolver` + luật hạn mức `media-ip` |

## sharp 0.35.5 — kiểm trước khi thêm (TL cho phép 18/10, B soát)

- Ghim chính xác `sharp: 0.35.5` trong catalog; `apps/api` dùng `catalog:`.
- `pnpm why sharp -r`: **Found 1 version of sharp** (0.35.5, qua `next` và `apps/api`);
  `pnpm why @img/sharp-libvips-linux-x64 -r`: **1 version** (1.3.4).
- Lockfile diff: chỉ thêm `catalogs.sharp`, importer `apps/api` → `sharp: catalog:`, và bỏ cờ `optional` của
  `sharp` / `@img/colour` (giờ là dependency trực tiếp của API). Không có gói mới.
- Integrity lockfile = registry (`npm view <pkg> dist.integrity`): `sharp@0.35.5`, `@img/sharp-linux-x64@0.35.5`,
  `@img/sharp-libvips-linux-x64@1.3.4`, `@img/sharp-win32-x64@0.35.5` — **MATCH** cả 4 (sharp =
  `sha512-Ywn4OnzG…`, trùng giá trị B kiểm).
- `pnpm audit --prod`: **No known vulnerabilities found** (exit 0).
- `pnpm peers check`: chỉ cảnh báo có sẵn `@babel/core` của `@sentry/bundler-plugins` — không liên quan sharp.
- NOTICE LGPL-3.0 của libvips: `THIRD_PARTY_NOTICES.md` (liên kết động, không sửa libvips, link mã nguồn).
- **B duyệt chuỗi cung ứng sharp (18/10):** B tự so integrity trên registry cho `@img/sharp-linux-x64@0.35.5`
  và `@img/sharp-libvips-linux-x64@1.3.4`, khớp lockfile; `sharp` khớp giá trị B gửi trước; lockfile diff tối
  thiểu; có NOTICE LGPL.

## Quyết định tự đưa ra ở bước 3

- **Trần đồng thời 3 upload / người** đếm trong bộ nhớ tiến trình (`UploadSlots`), vì v1 chạy một instance
  (R47). Lên ≥ 2 instance ⇒ chuyển sang Valkey cùng lúc với volume chung. Hạn mức theo thời gian (30 lượt /
  10 phút, 200 MB / ngày, fail-closed khi Valkey lỗi) là việc của route upload chat ở T-069.
- **Im lặng 15 s / tổng 180 s / client hủy** ⇒ hủy kết nối, không trả response (không có ai nhận); tmp
  xóa ngay, lượt được nhả khi socket đóng.
- **Mọi lỗi sau khi đã nhận request mà body chưa đọc** (400 tên, 413, 429, 507, lỗi đĩa) ⇒
  `Connection: close` + xả có trần (5 s VÀ 2 MB, chạm trần ⇒ `destroy`), để client đang gửi vẫn đọc được
  response. Riêng 415 ở `rawUpload` không xả (Content-Type sai — body không phải upload).
- Ngoại lệ content-type so path sau khi bỏ `/` cuối + chữ thường (cùng cách Express định tuyến).
- Soát B (edc564ae): **L1** nhánh 415 cũng `Connection: close` + xả; **L2** khi `req` bị pause vì backpressure
  (ổ ghi chậm) thì không tính là im lặng — trần tổng 180 s vẫn áp dụng (test kho giả ghi chậm; gỡ bản sửa ⇒
  test đỏ); **L3** trần chung **12 upload đồng thời / tiến trình** trong `UploadSlots` (429 + `Retry-After`).
- Bước 4 (ghi chú B): worker đọc bản tạm (`readAll`) trước khi có thể bị discard do response đóng; client hủy
  sau khi body đủ mà worker còn chạy ⇒ commit gặp ENOENT ⇒ 503 có kiểm soát — thêm test ở bước 4.

## Bước 4 — worker sharp

- Worker chạy mã nhúng (`new Worker(src, { eval: true })`), sharp nạp theo đường dẫn tuyệt đối
  (`createRequire(import.meta.url).resolve('sharp')`) qua `workerData` ⇒ giống nhau ở tsx / Vitest / bản build.
- Cấu hình theo B: `cache(false)`, `concurrency(1)`; MỌI `sharp()` dùng `{ pages: 1, animated: false,
  limitInputPixels: 40e6, failOn: 'error' }`; `metadata()` trước: `format` ∈ `IMAGE_TYPES` (hằng số DUY NHẤT
  dùng chung với `sniffType`: jpeg / png / webp / gif — B đồng ý giữ GIF theo ADR-141) VÀ = loại đã sniff, và
  `width × height` ≤ trần; rồi `.rotate()` ⇒ resize ⇒ WebP q82, không `withMetadata`. Thông điệp lỗi libvips
  không ra khỏi worker.
- Pool 2 worker, `resourceLimits.maxOldGenerationSizeMb = 256` (chỉ heap V8 — bộ nhớ libvips chặn bằng
  `limitInputPixels`), mỗi worker một việc, hàng chờ 4 ⇒ việc thứ 7: 503 `IMAGE_PROCESSING_BUSY` +
  `Retry-After: 5`; quá 10 s ⇒ giết worker (libvips không hủy được giữa chừng) + dựng mới + 422
  `IMAGE_TOO_COMPLEX`; worker chết giữa việc ⇒ 422 `IMAGE_TOO_COMPLEX`; chết trước khi sẵn sàng 2 lần liên
  tiếp ⇒ 503 `IMAGE_PROCESSING_UNAVAILABLE`, gauge 0; `selfTest` dựng lại pool khi sharp nạp lại được.
- Ánh xạ lỗi: format ≠ sniff ⇒ 415; vượt trần điểm ảnh ⇒ 422 `IMAGE_TOO_COMPLEX` (TL chốt); ảnh hỏng ⇒ 422
  `IMAGE_UNREADABLE`.
- Đo thực tế: GIF 60 khung `pages: 1` 9 ms vs giải mã mọi khung 58 ms. **GIF khai canvas 60000² với khung 1×1:**
  libvips lấy kích thước khung (1×1), không cấp phát canvas ⇒ xử lý bình thường trong vài ms (B dự đoán 422
  — đã báo B; không phải lỗ hổng).
- Tệp mẫu tối giản `tiff()` / `svgScript()` làm chính `metadata()` lỗi ⇒ 422 `IMAGE_UNREADABLE` (không đọc được
  format); tầng route đã 415 ở `sniffType` trước đó. SVG hợp lệ khai là png ⇒ 415 ở `metadata().format`.
- Commit sau `discard` (client đi khi worker còn chạy) ⇒ 503 `SERVICE_UNAVAILABLE` (test tầng route).
- **B duyệt bước 4 (79e09153).** Ghi chú không chặn merge:
  - **M:** `resourceLimits` chỉ chặn heap V8; bộ nhớ giải mã libvips là native — xấu nhất ≈ 2 worker × 40 MP ×
    4 byte ≈ 320 MB + bộ đệm resize ⇒ tính vào `mem_limit` container (B ghi `devops.md`, T-074). Đề xuất G:
    tách trần pixel theo mục đích ở **T-068** (avatar thấp, ví dụ 24 MP; chat 40 MP) — `transform` nhận thêm
    trần, worker dùng `min(tham số, trần chung)`.
  - **L:** `failOn` — đang hỏi lại B (theo tài liệu sharp, `truncated` lỏng hơn `error`; chặn JPEG cắt cụt cần
    `warning`). Đề xuất giữ `error` như ADR-141 (ảnh cắt cụt chỉ là chất lượng, không phải bảo mật).

## Bước 5 — `/media`

- `GET /api/v1/media/:kind/:id/:variant?v&exp&sig`, không Bearer. Thứ tự: zod (kind / uuid / variant theo kind /
  query strict) ⇒ chữ ký constant-time (`_PREVIOUS` để kiểm) — sai / hết hạn ⇒ 404 **không chạm DB, không chạm
  đĩa** (log debug `media.sig_invalid {kind, variant, reason}`, không query) ⇒ `IMediaResolver` kiểm DB mỗi lần
  (adapter Prisma ở T-068 / T-069) ⇒ mở blob (mất ⇒ 404 + `media.blob_missing`) ⇒ `pipeline(stream, res)` —
  client hủy ⇒ stream blob bị đóng (test, B L-b).
- Header: `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Referrer-Policy: no-referrer`,
  CORP theo `MEDIA_CORP`. Ảnh: `image/webp`, `inline`, `private, max-age=<giây còn lại của URL>`, ETag theo
  `(kind, id, variant, version)`, 304 khi trùng. Tệp: `application/octet-stream`, `attachment` + `filename*`,
  `no-store`, `Content-Length`.
- Mọi lỗi (404 / 429 / 500) trả MỘT trang HTML tối giản giống hệt nhau, không script; "Quay lại" là link
  thường về origin web (đổi so với ý định `history.back()` — `javascript:` bị CSP `sandbox` chặn).
- Hạn mức `RATE_LIMIT_RULES.media` 600 / phút / IP, fail-open (chữ ký + DB vẫn chặn); 429 kèm `Retry-After`.
- Query `/media` không vào log app (pino chỉ ghi path) và Sentry API (allow-list bỏ query — `sentry.ts`).
  Log Caddy + Sentry web: B / H (SEC-CH-20/25).
- `MediaUrlSigner`: URL tuyệt đối (`MEDIA_BASE_URL` — bước 6), khung `exp` avatar 24 giờ / ảnh chat 1 giờ, tải
  tệp 60 s; chỉ khóa hiện tại ký.

## Còn lại
6 env · 5 `/media` · 6 env · 7 `files-sweep` · 8 compose
volume + runbook backup tệp · 9 ca SEC-CH của G.

## Soát của B (18/10) — đã xử lý

- **M-a** `commit` KHÔNG ghi đè: hard link `tmp → đích` rồi bỏ tmp; đích đã có ⇒ `FileExistsError` (không thử
  lại). Test đua hai upload cùng khóa avatar: đúng một thắng, blob nguyên vẹn, không sót tmp. Phần (i) —
  cấp `avatar_version` bằng `UPDATE … RETURNING` dưới khóa dòng TRƯỚC khi commit blob — làm ở **T-068**.
- **M-b** `STALE_TEMP_AGE_MS` = 1 giờ (≥ 2 × (180 s + 10 s), có test); bản tạm mất trước commit ⇒ 503
  `SERVICE_UNAVAILABLE` có kiểm soát.
- **L-a** `forbiddenParents` so sau `realpath` (test junction).
- **L-d** `create` thử hard link trong `tmp/`; FS không hỗ trợ (FAT/exFAT, một số mount mạng, bind mount Docker
  Desktop: EPERM/ENOTSUP/EXDEV) ⇒ từ chối khởi động. EXDEV/ENOTSUP lúc commit không thử lại. **Ghi vào
  `devops.md`** (B, T-074): volume kho phải là ext4/xfs/NTFS.
- **L-c** bản tạm giữ một file handle đọc tới commit/discard. Chưa fsync thư mục sau khi đặt tệp ⇒ **rủi ro
  ghi vào `devops.md`** (B, T-074): mất điện ngay sau upload có thể mất tệp vừa nhận trên máy văn phòng.
- Bảng khóa phải bị từ chối (UUID hoa, `/01/`, 10 chữ số, `\`, `%2e`, `/` cuối / đầu, ổ đĩa, `ab/cd/<khóa>`, `\n` cuối).
- **L-b** (`pipeline(stream, res)` + test fd không rò khi client hủy) ⇒ bước 5 `/media`.
- **sharp** (bước 4): ghim 0.35.5; `pnpm why` một phiên bản; so integrity sharp / `@img/sharp-linux-x64` /
  `@img/sharp-libvips-linux-x64` / win32-x64 với registry; `pnpm audit --prod` vào báo cáo; NOTICE LGPL-3.0
  libvips; worker `cache(false)`, `concurrency(1)`, `limitInputPixels`, `failOn: 'error'`, kiểm
  `metadata().format` trong worker, không `withMetadata`, `resourceLimits` + timeout.
- **rawUpload** (bước 3): vượt trần giữa chừng ⇒ xóa tmp, 413 + `Connection: close`, xả có trần **5 s VÀ
  2 MB**, chạm trần ⇒ `req.destroy()`; `Content-Length` > trần ⇒ 413 không đọc byte nào.

## Câu hỏi mở

- (Đã chốt — TL 18/10) worker sharp quá thời gian / vượt trần điểm ảnh ⇒ rule riêng `IMAGE_TOO_COMPLEX` (422);
  `IMAGE_UNREADABLE` cho ảnh hỏng. Đã báo H câu hiển thị.
