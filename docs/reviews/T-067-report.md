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
| 5 | f0a8cea3, 03ce1754 | `/media` (`mediaRouter`) + `MediaUrlSigner` + port `IMediaResolver` + luật hạn mức `media-ip` (+ soát B L1) |
| 6 | 9584f6a9, 74afd33a, 70e994f5 | env + `.env.example`; `StorageQuota` (507) + `MediaResolverRegistry`; `createFiles` (composition); gắn `/media` trong `app.ts`; `start-server` |
| 7 | ed3343ac | `files-sweep` (bước tmp) + `FileSweepRegistry` + bật theo cờ / env test-only + lượt ON_START trước `listen` |
| 8 | da7177e4, 3dae7904 | volume `filestore` + `mem_limit` (compose), Dockerfile thư mục kho, `backup-files.sh`, Caddy body 21 MB, runbook §7 |

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
- Soát B (f0a8cea3): đạt. **L1** CSP thêm `frame-ancestors 'none'` (trang lỗi / tệp không có lý do bị nhúng
  frame; `<img>` không chịu ảnh hưởng). **L2 — hành vi có chủ đích, KHÔNG phải lỗi SEC-CH:** `Cache-Control:
  private, max-age=<exp-now>` ⇒ sau khi xóa ảnh / đổi avatar / rời hội thoại, bản ĐÃ CACHE trong trình duyệt của
  chính người đó còn hiện tối đa tới `exp` (avatar ≤ 24–48 giờ, ảnh chat ≤ 1–2 giờ); request MỚI thì 404 ngay.
  Nằm trong khung `exp` của ADR-141 (R43/R44).
- **`MEDIA_BASE_URL`** (biến mới, TL đồng ý 18/10 — TL cập nhật ADR-141 lúc gộp): origin công khai của API cho
  URL ký tuyệt đối; bắt buộc `https://` ở staging/production, mặc định `http://localhost:4000` ở local/test.
- `MediaUrlSigner`: URL tuyệt đối (`MEDIA_BASE_URL` — bước 6), khung `exp` avatar 24 giờ / ảnh chat 1 giờ, tải
  tệp 60 s; chỉ khóa hiện tại ký.

## Bước 6 — env + composition

- **Env** (`env.ts` + `.env.example`, script CI khớp 49 biến): `FILE_STORE_DIR` (tuyệt đối), `FILE_URL_SECRET` /
  `_PREVIOUS` (≥ 32 byte, khác JWT, `_PREVIOUS` ≠ hiện tại và cần khóa hiện tại), `FILE_STORE_MAX_BYTES` (50 GiB),
  `MEDIA_CORP`, `MEDIA_BASE_URL`. **Staging/production bắt buộc** `FILE_STORE_DIR`, `FILE_URL_SECRET` (không
  `test-only-` / `change-me`), `MEDIA_BASE_URL` https. **Chỉ APP_ENV=test** (khác ⇒ từ chối khởi động):
  `MEDIA_URL_{AVATAR,IMAGE}_BUCKET_SECONDS`, `MEDIA_URL_DOWNLOAD_TTL_SECONDS`, `FILES_ORPHAN_TTL_SECONDS`,
  `UPLOAD_IDLE_TIMEOUT_MS`, `FILE_STORE_USAGE_CACHE_MS`, `FILES_SWEEP_ON_START`, `FILES_SWEEP_INTERVAL_MS`,
  `FILES_IMAGE_PIPELINE_DISABLED` (tên đã thống nhất với F). `CHAT_*` thuộc T-069.
- **Local/test mặc định**: không `FILE_STORE_DIR` ⇒ `<os tmpdir>/taskflow-files`; không `FILE_URL_SECRET` ⇒ khóa
  ngẫu nhiên mỗi lần khởi động + log `files.url_secret_ephemeral` (quyết định G — không chặn dev/test cũ).
- **`StorageQuota`**: số đã dùng = duyệt cây kho (bỏ `tmp/`) + cộng ngay sau mỗi commit; đối soát mỗi
  `FILE_STORE_USAGE_CACHE_MS` (60 s); `rawUpload` kiểm trước khi ghi bản tạm ⇒ 507 `STORAGE_FULL`
  (+ `Connection: close`, xả có trần); ≥ 90 % ⇒ log `files.storage_nearly_full` (mỗi 5 phút cùng tự kiểm).
- Soát B (9584f6a9): đạt. **L2 — chấp nhận, ghi cho F:** quota có thể bị vượt CÓ GIỚI HẠN — các upload đồng thời
  đều qua kiểm 507 rồi mới cộng ⇒ vượt tối đa ≈ số lượt đồng thời × trần một tệp (12 × 20 MB); đã chặn bằng
  `UploadSlots`. **L1 (khi gộp Mốc 5):** vòng kiểm biến test-only chạy trên `TEST_ONLY_KEYS` (spread
  `FILES_TEST_ONLY_VARS`) — gộp với danh sách `TEST_ONLY_KEYS` của T-055 thành một.
- **Pool sharp khởi động LƯỜI (TL 18/10):** không dựng worker tới việc đầu tiên; worker rảnh 60 s ⇒ tắt, việc mới ⇒
  dựng lại; "đầy" tính theo đang chạy + chờ ≥ pool + hàng chờ (đúng cả lúc worker đang khởi động). Gauge
  `files_image_worker_up` = -1 tới lần tự kiểm đầu (sau `listen`), rồi 1 / 0. Tự kiểm chỉ giữ worker ≤ 60 s.
- **`MediaResolverRegistry`**: T-068 / T-069 `register('avatars' | 'chat', resolver)`; chưa đăng ký ⇒ 404.
- **`createFiles`** dựng kho (từ chối khởi động nếu không dùng được / nằm trong cwd), pipeline (hoặc Disabled),
  quota, signer, registry, `upload(maxBytes)`, router `/media` + hạn mức IP; gauge `files_image_worker_up`;
  `startHealthChecks()` sau `listen` (lúc khởi động + mỗi 5 phút, không ảnh hưởng `/readyz`); `close()` khi tắt
  (trước Prisma/pool).
- **`app.ts`**: `/api/v1/media` gắn NGAY SAU health, TRƯỚC `requireJsonContentType` / body parser / `no-store` /
  rate limit toàn cục (test: CSP sandbox, CORP, `Cache-Control: private` không bị helmet / `no-store` đè; lỗi là
  HTML, không phải JSON envelope).

## Kết quả chạy (lượt máy TL cấp 18/10, worktree C: `feat/T-067` @74afd33a + sửa test startup)

- Unit toàn phần `apps/api` (`vitest run --maxWorkers=2`): **179 file / 2099 ca xanh**, exit 0, không Unhandled.
- Integration (`test:integration`, DB riêng `taskflow_t067`, Valkey db 7, `REQUIRE_INTEGRATION=1`, không
  `VITEST_MAX_WORKERS`): lượt 1 **1 đỏ / 766** — `task-prisma-startup.int.ts` (staging): `productionEnvVars` khai
  `FILE_STORE_DIR=/var/lib/taskflow/files` không tồn tại ⇒ API từ chối khởi động ĐÚNG như ADR-141. Sửa test: dùng
  thư mục tạm thật (`mkdtemp`, dọn ở `afterAll`). Chạy lại 2 lượt: **65 file / 766 ca xanh**, exit 0.

## Bước 7 — `files-sweep`

- Job `files-sweep` (dạng `ScheduledJob` của maintenance scheduler, mẫu T-033): mỗi giờ + jitter 5 phút, lượt đầu sau
  60 s; signal hủy ⇒ dừng giữa các bước. Bước T-067: tệp tạm cũ hơn `STALE_TEMP_AGE_MS` (1 giờ — lưới an toàn).
- `FileSweepRegistry`: T-068 / T-069 đăng ký bước có DB (upload chưa gắn > `FILES_ORPHAN_TTL_SECONDS`, blob không
  còn tham chiếu, avatar người đã rời + 30 ngày, `left_at` participant) — theo lô, idempotent, khóa advisory, xóa DB
  trước rồi mới xóa đĩa. Một bước lỗi không chặn bước sau; lượt vẫn tính THẤT BẠI (`FilesSweepIncompleteError` ⇒
  `maintenance.run_failed` + metric failure). Log `files.sweep_summary {removed, failed, aborted}` chỉ số đếm.
- Bật: theo cờ bảo trì chung (`MAINTENANCE_JOBS_ENABLED`; staging/production mặc định bật), hoặc ở test khi đặt
  `FILES_SWEEP_INTERVAL_MS` (không jitter, lượt đầu sau đúng chu kỳ) / `FILES_SWEEP_ON_START` (một lượt TRƯỚC
  `listen`, log `maintenance.run_done {job: 'files-sweep'}` — CLK-CH của F).

## Bước 8 — volume compose + backup tệp (khớp `devops.md` §4.3 / §4.4 / §4.6 của B @a4b0c06c)

- `deploy/vps/compose.prod.yml`: volume tên `filestore:/var/lib/taskflow/files` cho `api` (+ `FILE_STORE_DIR` đặt cứng,
  `mem_limit: 1536m` theo §4.6 — bộ nhớ native libvips); `backup` mount kho **chỉ đọc**, lệnh
  `backup.sh && backup-files.sh`, heartbeat chỉ khi cả hai xong. `docker compose config` hợp lệ (biến giả).
- `apps/api/Dockerfile`: tạo `/var/lib/taskflow/files` chủ `node` trước `USER node` (volume tên mới lấy quyền này).
- `docker/backup/backup-files.sh` (+ Dockerfile COPY): `tar | age | aws s3 cp -` cùng thiết kế `backup.sh` — public
  key only, tầng chọn lúc tải lên, `.ok` khi mọi bước xong, loại `tmp/`, tar exit 1 (tệp biến mất) chấp nhận, ≥ 2 lỗi;
  `BACKUP_FILES_EXPECTED_SIZE`. Thử với `age` / `aws` giả: archive có blob + avatar, không có `tmp/`, tầng
  weekly / monthly / daily đúng, `.ok` có, recipient không phải `age1…` ⇒ exit 2.
- `deploy/vps/Caddyfile`: `request_body max_size 21MB` cho API; chú thích bắt buộc lọc query nếu bật access log
  (không bật hiện tại ⇒ không có `sig` trong log Caddy).
- Runbook `backup-restore.md` §7: sao lưu, khôi phục (DB trước, tệp sau, không giải nén chồng, chown 1000), diễn tập
  hằng tháng (khóa từ két, ≥ 20 khóa qua `/media`, tệp thừa do sweep dọn), những gì không làm.
- Chưa build image Docker (job nặng; image backup / api thuộc cổng CI). B / D soát phần deploy.

## Bước 9 — ca U / I của G trong phạm vi T-067 (kiểm kê cho F — test-spec-chat §2 / §9)

| Mã ca | File (apps/api) | Ghi chú |
|---|---|---|
| CH-03 | `src/core/files/domain/sniff-type.test.ts`, `test/files/sniff-fixtures.test.ts` | mỗi hàm sinh §1.2 một ca (48) |
| CH-04 | `src/core/files/domain/file-name.test.ts` | sanitize, NFC, bidi, X-Upload-Name 255/256 byte |
| CH-09 | `src/core/files/domain/media-signature.test.ts` | tuple, `_PREVIOUS`, biên hết hạn, bảng khóa bị từ chối |
| CH-12 (vế tmp) | `src/core/files/infrastructure/local-file-store.test.ts`, `src/core/files/files-sweep.test.ts` | tmp < 1 giờ không bị xóa; vế upload mồ côi < TTL ⇒ T-069 |
| CH-14 | `local-file-store.test.ts` | fs giả EPERM ×4 rồi được; hết lượt; ENOSPC / EXDEV không thử lại |
| AV-03 | `media-signature.test.ts` (`bucketExpiry`), `media-router.test.ts` (signer) | |
| AV-06 | `src/composition/files-setup.test.ts`, `image-pipeline.test.ts` | Disabled / không nạp ⇒ 503, gauge 0 (−1 trước lần kiểm đầu) |
| AV-02 (vế pipeline) | `test/files/image-pipeline.sharp.test.ts` | EXIF / GPS / XMP / ICC bị bỏ, 256 / 64 — vế route ⇒ T-068 |
| Vế U của SEC-CH-06/07/08/09/10/11/12/21/22/23/24/26/27/31/33/34/35/36/37 | `sniff-type`, `raw-upload`, `media-router`, `image-pipeline(.sharp)`, `env`, `storage-quota`, `upload-client-gone` | hộp đen thật (route) ⇒ T-068 / T-069 (F) |
| CC-CH-04 (vế kho) | `local-file-store.test.ts` | 2 commit cùng khóa avatar ⇒ đúng một thắng; vế DB ⇒ T-068 |
| CC-CH-09 | `image-pipeline.test.ts` | pool 2 + chờ 4 ⇒ 503 + Retry-After 5 |

- Coverage `src/core/files/**` (phạm vi `src/core/files` + `test/files` + composition): 95,4 % stmts · 91,5 % branch ·
  92,3 % funcs · 97,7 % lines — trên ngưỡng core (90 / 85 / 90 / 90). Stryker `core/files/domain` ≥ 90 % ⇒ F (máy rảnh).
- Sửa ca flaky `upload-client-gone` (dưới coverage `commit` chạy trước khi response đóng): handler chờ ĐÚNG sự kiện
  `close` của response (trần 5 s) thay vì ngủ 300 ms — 5 / 5 lượt xanh.
- CH-01/02/05–08/10/11/13/15/16, AV-01/04/05/07, CC-CH-07/08 thuộc T-068 / T-069 (cần bảng / route / realtime). · 5 `/media` · 6 env · 7 `files-sweep` · 8 compose
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
