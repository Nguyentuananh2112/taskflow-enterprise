# Đặc tả test — Mốc 6 Avatar + Trò chuyện (T-073)

> Căn cứ: `docs/design/avatar-chat.md` v2.1 (người dùng duyệt, main c578622), phản biện F `docs/reviews/F-m6-avatar-chat-review.md`. Người viết: F (QA). Ngày 2026-10-17.
> Bài học Mốc 3.5:
> - **kiểm kê mã ca theo file NGAY khi viết** (§9);
> - **ca hộp đen S / C do người KHÔNG phải tác giả module viết**, F soát cuối mọi file;
> - một công ty dùng chung mọi ca ⇒ không đếm tuyệt đối, tìm theo id / `q` duy nhất.
>
> Mã ca giữ nguyên như thiết kế. Đặc tả này chỉ thêm mong đợi chi tiết, người viết, file đích, tầng.

## 0. Quy ước

### 0.1 Tầng

| Tầng | Chạy ở | Ghi chú |
|---|---|---|
| **U** | vitest, hàm thuần | `chat/domain`, `core/files/domain` |
| **I** | vitest integration (Postgres thật, `DATABASE_URL_TEST`) | adapter Prisma, `LocalFileStore` trên thư mục tạm, worker sharp |
| **S** | suite bảo mật hộp đen (`test/security/*.sec.ts`, harness company) | API thật, DB riêng mỗi file, **không chạm DB**. **Được đọc cây thư mục kho `FILE_STORE_DIR`** (TL chốt — quan sát hạ tầng như `api.logs()`) |
| **C** | đua ×20 trong suite S | mẫu `red[]` gom vòng đỏ, `SEC_HR_RACE_RUNS` |
| **K** | S với `TEST_CLOCK_ANCHOR` + `api.restart` mốc tiến | retention 12 tháng, avatar 30 ngày (đồng hồ nghiệp vụ) |
| **E** | Playwright (`e2e/specs/chat.e2e.ts`, `avatar.e2e.ts`) | project `chromium` + `mobile` @main; xem §6 |
| **P** | script đo ở `apps/api/test/perf/` | seed bằng script DB (ngoại lệ ADR-140 **chỉ** ở P) |
| **M** | Stryker | chỉ khi TL báo máy rảnh |

### 0.2 Bối cảnh chuẩn (harness company — `useCompanyApi`, ADR-140)

- **Người:** Ada (Admin, bootstrap); Hana (EMPLOYEE + `HR_MANAGE`); Kay (EMPLOYEE + `PAYROLL_MANAGE`); Mia, Vic, Otto (EMPLOYEE); Nina (chờ kích hoạt — `createUser({pending: true})`); Quinn (đã nghỉ — `startDate` −3, `offboard(lastDay = hôm qua)`).
- **W1:** Mia OWNER, Vic MEMBER, Max VIEWER.
- **Hội thoại:** DIRECT Mia↔Vic; GROUP "G1" (Mia OWNER, Vic, Otto); phòng W1.
- Ca **đổi trạng thái** (bớt người, nghỉ việc, xóa tin, gỡ avatar) **tự tạo người / hội thoại mới**, không dùng bối cảnh chung.

### 0.3 Thứ tự lỗi (ADR-146)

401 (không token / token hỏng) → 401 `SESSION_REVOKED` (không thuộc công ty hoạt động) → 403 → 400 → **404 khi không phải người tham gia** (không lộ tồn tại) → 413 / 415 → 422 / 409 → 429 → 503 / 507.

`/media`: chữ ký sai / hết hạn / không còn quyền / blob mất ⇒ **cùng 404 + HTML tối giản**, không JSON (§1.4).

### 0.4 Luật cách ly (một công ty — bài học Mốc 3.5)

1. Không khẳng định số tuyệt đối của danh sách toàn công ty (`chat/people`, `GET chat/conversations` của Admin). Tìm người bằng `q` = một phần **email / tên duy nhất của ca**.
2. **Unread / badge:** chỉ khẳng định cho người dùng **tạo riêng trong ca** (không ai khác nhắn họ).
3. **Kho tệp:** mỗi file suite một `FILE_STORE_DIR` tạm (§1.3). Khẳng định số tệp theo **delta** trong ca (trước / sau), không tuyệt đối.
4. **Hạn mức:** gọi `flushRateLimitCounters()` trước ca chạm hạn mức; ca hạn mức dùng người riêng.
5. **Cửa sổ thời gian:** dùng env test-only (ADR-141): `CHAT_EDIT_WINDOW_SECONDS=2`, `MEDIA_URL_DOWNLOAD_TTL_SECONDS=3`, `MEDIA_URL_IMAGE_BUCKET_SECONDS=4`, `MEDIA_URL_AVATAR_BUCKET_SECONDS=6`, `FILES_ORPHAN_TTL_SECONDS=5`, `UPLOAD_IDLE_TIMEOUT_MS=2000`, `CHAT_UPLOAD_DAILY_BYTES=2097152`, `FILE_STORE_USAGE_CACHE_MS=0`.
   - File nào cần giá trị thật thì ghi đè trong `useCompanyApi({...})` của file đó.
   - Ca "download-url sau 61 s" dùng TTL 3 s (đúng ý nghĩa, không chờ 61 s).
6. **Ngày nghỉ, lịch:** chat không dùng ⇒ suite chat **không** cần project `-hr`, chạy song song được ở E nếu mỗi ca tự tạo người.

## 1. Harness (F làm — T-073, trước khi G xong T-069)

### 1.1 Upload nhị phân — `test/security/harness/upload.ts`

```ts
upload(api, token, body: Buffer, opts: {
  path?: '/chat/uploads' | '/me/avatar';   // mặc định chat
  as?: 'image' | 'file';                   // query ?as=
  name?: string | null;                    // X-Upload-Name (encodeURIComponent); null ⇒ không gửi header; rawName ⇒ gửi nguyên (ca hỏng)
  rawName?: string;
  contentType?: string;                    // mặc định application/octet-stream
  chunked?: boolean;                       // không Content-Length (Transfer-Encoding: chunked)
  declaredLength?: number;                 // Content-Length khai sai
  abortAt?: number;                        // byte — hủy socket ở đó (SEC-CH-26)
  dripBps?: number;                        // gửi chậm (SEC-CH-27)
  method?: string;                         // SEC-CH-34 đúng path sai method
}): Promise<RawResponse | { aborted: true }>
```

- Dùng `node:http` trực tiếp, vì `rawRequest` hiện chỉ nhận body chuỗi. Mở rộng `rawRequest` nhận `Buffer | Readable`, giữ tương thích.
- **`media(api, url)`:** GET không Bearer, trả `{status, headers, body: Buffer, text}`.
- `parseSignedUrl(url)` ⇒ `{path, v, exp, sig}` để ca SEC-CH-11 / 35 sửa từng phần.

### 1.2 Tệp mẫu sinh lúc chạy — `test/security/harness/files/fixtures.ts` (không commit nhị phân)

> Đã làm: **thuần Node** (zlib + byte tay), **không cần sharp** — dùng được trước khi `apps/api` có sharp. JPEG baseline xám tối thiểu, PNG RGB, EXIF GPS chèn APP1, ZIP STORED tự dựng. `fixtures.test.ts` giải mã thật bằng sharp 0.35.5 tìm trong `node_modules/.pnpm`, nên tệp mẫu được chính thư viện của API đọc được.

| Hàm | Cách sinh | Dùng ở |
|---|---|---|
| `jpeg/png/webp/gif({w,h})` | sharp | mọi ca ảnh |
| `jpegWithGps()` | sharp `withExif` ghi IFD GPS; không ghi được ⇒ chèn APP1 Exif bằng byte tay | SEC-CH-07 |
| `pixelBombPng(50000, 50000)` | IHDR tự dựng + IDAT zlib nhỏ (deflate 1 dòng lặp) — **không** qua sharp | SEC-CH-08 |
| `gifJsPolyglot()` | `GIF89a` + comment chứa `/*…*/alert(1)` | SEC-CH-06 |
| `html()`, `svgScript()`, `exeMz()`, `elf()`, `machO()`, `shebang()` | byte tay | SEC-CH-06 / 21 |
| `zipStored(entries)` | ZIP STORED tự dựng (local header + central directory) — không thêm dependency | `docx/xlsx/odt`, ZIP thuần |
| `docx({macro?, externalLink?, oleObject?, order?})`, `odt({basic?})`, `bigZip(2001)` | `zipStored` + `[Content_Types].xml` / `mimetype` | SEC-CH-23 / 32 / 36 |
| `csv('utf8'\|'utf8bom'\|'utf16le'\|'utf16be'\|'win1258')`, `textWithNul()` | `Buffer` + bảng mã 1258 tối thiểu | SEC-CH-32 |
| `bytes(n)` | `Buffer.alloc` (nội dung PDF tối thiểu `%PDF-1.4…`) | SEC-CH-08 / 14 |
| `tiffAsJpg()`, `pngMagicButCorrupt()` | byte tay | SEC-CH-21 / 33 |

- **Bộ Office thật** (Word, LibreOffice, Google Docs, WPS — SEC-CH-32): tạo một lần, để **ngoài repo** ở `$SEC_OFFICE_SAMPLES_DIR`.
- TL chốt: F sinh bằng **LibreOffice headless** + mẫu công khai giấy phép tự do (không hỏi người dùng). Thiếu mẫu ⇒ ca khai pending `T-073-office` có ghi chú công cụ thiếu (không xanh giả).

### 1.3 Kho tệp mỗi suite — `test/security/harness/files/store.ts`

- `useCompanyApi` nhận thêm `FILE_STORE_DIR = mkdtemp(<os.tmpdir>/tf-sec-files-)`, `FILE_URL_SECRET` = hằng test ≥ 32 byte ≠ `TEST_JWT_SECRET`, cùng các env cửa sổ (§0.4-5). `afterAll` xóa thư mục.
- `storeTree()` ⇒ danh sách đường dẫn tương đối + kích thước; `tmpFiles()`; `countBlobs()`; `outsideWrites(parent)` (so cây thư mục cha trước / sau — SEC-CH-09).
- `deleteBlob(key)` — chỉ dùng ở SEC-CH-31 (mô phỏng mất ổ); key lấy từ cây thư mục, **không** từ DB.

### 1.4 Khẳng định chung

- `expectMedia404(res)`: status 404, `content-type` text/html, CSP `sandbox`, body chứa "Liên kết đã hết hạn hoặc không còn tồn tại", **giống hệt nhau** giữa các nguyên nhân (so body).
- `expectNoTmp(within = 2000)`: poll `tmpFiles()` rỗng trong ≤ 2 s.

### 1.5 E2E

- `apiServerEnv()` thêm `FILE_STORE_DIR` (thư mục tạm của lượt, xóa ở globalTeardown) và `FILE_URL_SECRET`.
- `support/chat.ts`:
  - `apiDirect`, `apiSend`, `apiUpload` qua API (seed);
  - `uploadViaUi(page, file)` dùng `setInputFiles` với Buffer;
  - `dropFiles(page, target, files)` dựng `DataTransfer` trong `page.evaluate`;
  - `pasteImage(page)` — `navigator.clipboard.write`, chỉ Chromium;
  - `downloadSha256(page, trigger)` — `waitForEvent('download')`.
- Selector theo H (§6).

## 2. AV / CH — đơn vị và tích hợp (G viết — tác giả; F kiểm phủ + Stryker)

Nội dung theo thiết kế §6. F thêm mong đợi cụ thể:

| ID | Tầng | Thêm từ F |
|---|---|---|
| AV-01 | I | 3 lần `PUT` ⇒ version 1, 2, 3; chỉ còn blob của version 3 (đếm thư mục `avatars/<id>/`) |
| AV-02 | I | Đọc metadata biến thể bằng sharp: `exif`, `icc` (trừ sRGB), `xmp` = undefined; kích thước đúng 256 / 64 |
| AV-03 | U | `mediaExpBucket(now)` ổn định trong khung, đổi đúng biên khung (±1 ms) |
| AV-04 | I | Người đã nghỉ ⇒ `avatarUrl: null` ở `/auth/me` của người khác (task assignee, thành viên ws) |
| AV-05 | K | → §5 CLK-CH-02 |
| AV-06 | I | Worker không nạp (`FILES_IMAGE_PIPELINE_DISABLED=1`, chỉ test — G) ⇒ `PUT me/avatar` 503 `IMAGE_PROCESSING_UNAVAILABLE`, `/readyz` 200, `files_image_worker_up = 0` |
| AV-07 | I | Socket người khác nhận `user:avatar-changed {userId, avatarUrl}` trong ≤ 2 s |
| CH-01…16 | U / I | như thiết kế; CH-03 phải có đủ hàng trong bảng §1.2 (một ca U cho mỗi hàm sinh); CH-13 khóa giả định `company_members` chỉ tạo lúc vào làm / nhận lại (đổi ⇒ đỏ); CH-14 fs giả ném `EPERM` 4 lần rồi được |

## 3. SEC-CH — hộp đen (tầng S)

**Người viết** theo luật "không phải tác giả module":
- **F**: quyền / IDOR / vòng đời — vì F không viết module chat.
- **H**: ca có thành phần web (XSS hiển thị, Sentry web).
- **F** cũng nhận nhóm tệp / URL ký (TL chốt 17/10 — B ở đường găng Mốc 4/5). **B soát bảo mật** các ca đó (diff + mong đợi) trước khi gộp.
- **G (tác giả) KHÔNG viết ca S / C** — chỉ U / I (TL chốt, thay §9 cũ của thiết kế).

Kịch bản xem thiết kế §5. Cột "Mong đợi chi tiết" là phần F thêm để viết được assert.

| ID | Người viết | File | Mong đợi chi tiết |
|---|---|---|---|
| SEC-CH-01 | F | `chat-idor.sec.ts` | Otto: `GET …/messages`, `POST …/messages`, `PUT …/read`, `PATCH/DELETE chat/messages/:id` của DIRECT Mia↔Vic ⇒ 404. So body với id ngẫu nhiên ⇒ **giống hệt**. Sau đó Mia đọc lại: tin không đổi, unread của Mia không đổi |
| SEC-CH-02 | F | `chat-idor.sec.ts` | Otto gắn `uploadId` của Mia ⇒ 404 (giống upload không tồn tại); `download-url` của tệp ở G1 (Otto đã bị bớt) ⇒ 404 |
| SEC-CH-03 | F | `chat-idor.sec.ts` | Ada, Hana: mọi route `chat/conversations/:id…` + `PUT chat/workspaces/:wsId/conversation` của W2 (không là thành viên) ⇒ 404; `GET chat/conversations` không chứa id đó |
| SEC-CH-04 | F | `chat-lifecycle.sec.ts` | 3 vế, mỗi vế người mới + socket mở sẵn. Sau khi bớt / rời / nghỉ: REST 404 (ws, nhóm) / 401 (nghỉ); `collect('chat:message:new')` 3 s sau một tin mới ⇒ `[]`; typing của họ: tối đa 5 s còn tới, sau 6 s ⇒ không |
| SEC-CH-05 | F | `chat-clock-0559.sec.ts` (K) | Mẫu `company-clock-0559` (05:59:10, tự khẳng định còn OFFBOARDING). Sau 06:00: REST 401 `SESSION_REVOKED`; Mia gửi vào DIRECT ⇒ socket người hết hạn không nhận |
| SEC-CH-06 | F | `chat-upload-types.sec.ts` | Từng tệp ⇒ 415 `UNSUPPORTED_FILE_TYPE`, `storeTree` không thêm gì. Polyglot GIF ⇒ 201; tải biến thể ⇒ không chứa chuỗi `alert(` và là WebP hợp lệ |
| SEC-CH-07 | F | `chat-upload-types.sec.ts` | Tải `preview`, `thumb` và avatar 256 / 64 ⇒ sharp `metadata()`: không `exif`, không GPS; byte không chứa `GPS` / `Exif` |
| SEC-CH-08 | F | `chat-upload-limits.sec.ts` (NẶNG) | Mỗi vế ≤ 2 s: pixel bomb ⇒ 422; 21 MB ⇒ 413 (ngay theo `Content-Length`); chunked 25 MB ⇒ 413; avatar 6 MB ⇒ 413. `expectNoTmp`. Bỏ vế RAM (TL) |
| SEC-CH-09 | F | `chat-upload-limits.sec.ts` | `../../etc/passwd`, U+202E, NUL ⇒ 201 + `filename*` sạch (không `/`, `\`, bidi, NUL) + `outsideWrites` rỗng; thiếu / `%E0%A4%A` / 256 byte ⇒ 400 `INVALID_UPLOAD_NAME`, không ghi |
| SEC-CH-10 | F | `chat-media.sec.ts` | Header từng loại đúng bảng ADR-141; CORP = giá trị `MEDIA_CORP` của env test (`same-site` mặc định; một ca chạy `cross-origin`) |
| SEC-CH-11 | F | `chat-media.sec.ts` | Sửa `exp` / `sig` / path / `v` / URL hết hạn (chờ khung test) / `download-url` sau TTL ⇒ `expectMedia404`, body giống hệt |
| SEC-CH-12 | F | `chat-upload-types.sec.ts` | multipart / text/plain có Bearer ⇒ 415; không Bearer ⇒ 401; không ghi |
| SEC-CH-13 | H | `e2e/specs/chat.e2e.ts` (E) + `chat-idor.sec.ts` (S: thân lưu nguyên văn) | E: `arm()` + `assertInert`; link chỉ `http(s)`; `a[href^="javascript:"]` = 0 |
| SEC-CH-14 | F | `chat-limits.sec.ts` | 31 tin / phút ⇒ 429 + `Retry-After`, tin 31 không có trong `messages`; 31 upload / 10 phút ⇒ 429; vượt 2 MB / ngày ⇒ 429; `FILE_STORE_MAX_BYTES` 3 MB ⇒ 507 `STORAGE_FULL` (file riêng env) |
| SEC-CH-15 | F | `chat-groups.sec.ts` | Vic (thành viên) thêm / bớt / đổi tên / giao OWNER ⇒ 403; thêm Quinn / Nina ⇒ 422 `NOT_ACTIVE_MEMBER`; id lạ ⇒ 404 `user` |
| SEC-CH-16 | F | `chat-messages.sec.ts` | Sửa / xóa tin Vic ⇒ 404; chờ > 2 s rồi sửa ⇒ 422 `EDIT_WINDOW_PASSED`; sửa tin đã xóa ⇒ 404 |
| SEC-CH-17 | F | `chat-avatar.sec.ts` | Mia → Vic: 403. Hana → Ada / Kay / chính mình: 403. Ada → Hana: 204 + audit `AVATAR_REMOVED` (đọc `hr/audit-logs` bằng Ada) + URL cũ ⇒ 404 |
| SEC-CH-18 | F | `chat-people.sec.ts` | `q` = email riêng của ca: không trường `email` trong mọi phần tử; Nina, Quinn không có; Ada có |
| SEC-CH-19 | F | `chat-realtime.sec.ts` | Otto phát `chat:typing` cho DIRECT Mia↔Vic ⇒ Mia, Vic không nhận; Mia phát 10 / s ⇒ Vic nhận ≤ 1 / 3 s |
| SEC-CH-20 | F (API) + H (web) | `chat-logs.sec.ts` + E2E Sentry tunnel | `api.logs()` không chứa thân tin canh (`CANARY-<uuid>`), tên tệp canh, `sig=`, query `/media`. Web: event + breadcrumb Sentry (tunnel E2E-T-035) không có `sig` |
| SEC-CH-21 | F | `chat-upload-types.sec.ts` | SVG / TIFF đổi tên `.jpg` ⇒ 415; `storeTree` không có biến thể mới |
| SEC-CH-22 | F | `chat-media.sec.ts` | Xóa tin ⇒ URL `preview` / `thumb` đã phát ⇒ `expectMedia404` ngay (trước sweep) |
| SEC-CH-23 | F | `chat-upload-types.sec.ts` | `vbaProject.bin`, `externalLink` ⇒ 415 `MACRO_OR_ACTIVE_CONTENT` |
| SEC-CH-24 | F | `chat-upload-limits.sec.ts` | 4 upload song song (drip để giữ mở) ⇒ đúng một 429 |
| SEC-CH-25 | F | — (ngoài suite) | Log Caddy không có trong S ⇒ kiểm ở smoke Compose (`devops`, B) + `api.logs()` ở SEC-CH-20. Ghi `outOfScope` |
| SEC-CH-26 | F | `chat-upload-limits.sec.ts` | `abortAt` 50 % ⇒ `expectNoTmp` |
| SEC-CH-27 | F | `chat-upload-limits.sec.ts` | `dripBps` 1 KB/s, `UPLOAD_IDLE_TIMEOUT_MS` 2 s ⇒ server cắt (socket đóng ≤ 4 s); `expectNoTmp` |
| SEC-CH-28 | F | `chat-lifecycle.sec.ts` | Nghỉ rồi nhận lại: `GET chat/conversations` không có G1, có DIRECT cũ; OWNER thêm lại ⇒ thấy G1 + lịch sử |
| SEC-CH-29 | — | — | gộp vào SEC-CH-22 (không dùng lại số) |
| SEC-CH-30 | F | `chat-lifecycle.sec.ts` | Ws xóa mềm ⇒ 404 cho mọi thành viên; khôi phục ⇒ đọc lại được. Purge (gọi job qua API? — không có ⇒ **I** ở G, F soát): cascade + blob bị sweep |
| SEC-CH-31 | F | `chat-media.sec.ts` | `deleteBlob` ⇒ 404 (không 500) + log cảnh báo; 601 GET `/media` cùng IP / phút ⇒ 429; chữ ký sai: kho không có lượt đọc (dùng ổ thật: thời gian ≈ chữ ký đúng-không-tồn tại; khẳng định qua log debug `media.sig_invalid` không kèm `open`) |
| SEC-CH-32 | F | `chat-upload-types.sec.ts` | Bộ Office thật ⇒ 201 (pending nếu thiếu mẫu); CSV 5 bảng mã ⇒ 201; TXT có NUL ⇒ 415 |
| SEC-CH-33 | F | `chat-upload-types.sec.ts` | PNG magic nhưng `format` khác ⇒ 415; hỏng giữa chừng ⇒ 422; không biến thể |
| SEC-CH-34 | F | `chat-upload-types.sec.ts` | octet-stream tới `POST /chat/conversations/:id/messages`, `PATCH /auth/me` ⇒ 415; `PUT /chat/uploads` ⇒ 404 / 405 |
| SEC-CH-35 | F | `chat-media.sec.ts` + `chat-media-rotate.sec.ts` | Đổi tuple giữ `sig` ⇒ 404. Ký bằng `_PREVIOUS` (file riêng, restart với secret mới + previous = cũ) ⇒ 200. Secret < 32 byte / = JWT ⇒ `startApi` thất bại với thông điệp rõ (mẫu `production.sec`) |
| SEC-CH-36 | F | `chat-upload-types.sec.ts` | `macroEnabled`, `oleObject`, ODF `Basic/`, 2 001 entry, `.docm` → `.docx` ⇒ 415 |
| SEC-CH-37 | F | `chat-upload-limits.sec.ts` | Ổ trống < trần: **I** (fs giả `statfs`) vì S không giả ổ đầy được. Valkey lỗi ⇒ upload 503 (container Valkey tạm như `valkey-outage.sec`) |

## 4. CC-CH — đua (tầng C, ×20, mẫu `red[]`)

| ID | Người viết | File | Mong đợi chi tiết |
|---|---|---|---|
| CC-CH-01 | F | `chat-races.sec.ts` | 5 POST cùng `clientMsgId` ⇒ [201, 200×4]; `messages` có đúng 1; socket người nhận đúng 1 `chat:message:new` |
| CC-CH-02 | F | `chat-races.sec.ts` | Mia, Vic cùng `POST chat/direct` ⇒ cùng `id` |
| CC-CH-03 | F | `chat-races.sec.ts` | OWNER rời ‖ OWNER bớt người cuối ⇒ không 5xx; `effectiveGroupOwners` (đọc qua `GET conversation`) luôn có ≥ 1 OWNER hiệu lực hoặc nhóm không còn ai |
| CC-CH-04 | F | `chat-races.sec.ts` | 2 `PUT me/avatar` ⇒ `avatar_version` cuối có blob; sau sweep (TTL test) không blob mồ côi trong `avatars/<id>/` |
| CC-CH-05 | F | `chat-races.sec.ts` | `PUT read` 10 lệnh lệch thứ tự ⇒ con trỏ = max (unread = 0 với tin cuối) |
| CC-CH-06 | F | `chat-races.sec.ts` | Cùng `uploadId` vào 2 tin song song ⇒ [201, 404] |
| CC-CH-07 | F | `chat-races.sec.ts` | Xóa tin ‖ sweep ‖ tải ⇒ không 5xx; kết cục: 404 hoặc tải đủ byte |
| CC-CH-08 | F | `chat-races.sec.ts` | Gắn upload ‖ sweep ở biên TTL 5 s ⇒ hoặc gắn được và blob còn, hoặc 404 và blob bị xóa; không "gắn được mà blob mất" |
| CC-CH-09 | F | `chat-upload-limits.sec.ts` | 3 ảnh song song (pool 2 + chờ 4 ⇒ thêm tải nặng để đầy) ⇒ có 503 `IMAGE_PROCESSING_BUSY` + `Retry-After: 5`; không 5xx khác |

## 5. CLK-CH — đồng hồ nghiệp vụ (tầng K)

| ID | Người viết | File | Kịch bản | Mong đợi |
|---|---|---|---|---|
| CLK-CH-01 (= SEC-CH-05) | F | `chat-clock-0559.sec.ts` | xem §3 | — |
| CLK-CH-02 (= AV-05) | F | `chat-clock-avatar.sec.ts` | Quinn có avatar; nghỉ; restart mốc +31 ngày với `MAINTENANCE_INTERVAL_MS` ngắn; chờ sweep chạy | blob avatar Quinn bị xóa; người nhận lại ở +29 ngày còn blob |
| CLK-CH-03 (= CH-11 hộp đen) | F | `chat-clock-retention.sec.ts` | Tin + ảnh lúc mốc; restart +365 ngày −1 phút / +365 ngày +1 phút; chạy job retention | còn / mất; URL ảnh 404 sau khi mất |

> TL chốt: **không** route kích job. Env chỉ `APP_ENV=test` (G): `FILES_SWEEP_ON_START=1` / `CHAT_RETENTION_ON_START=1` (chạy một lượt trước ready, log `maintenance.run_done`) + rút chu kỳ job (vd `MAINTENANCE_INTERVAL_MS` cho `files-sweep` / `chat-retention`) + `TEST_CLOCK_ANCHOR` + `api.restart` mốc tiến. Job chạy lần đầu sau khởi động + chu kỳ rút ngắn ⇒ ca chờ theo điều kiện (poll `storeTree` / `GET messages`). Không đủ ⇒ hạ xuống **I** (G viết, F soát).

## 6. E2E-CH (tầng E)

| ID | Người viết | File | Ghi chú thêm |
|---|---|---|---|
| E2E-CH-01 | H | `avatar.e2e.ts` | Selector H (17/10): `region "Ảnh đại diện"`, `getByLabel('Chọn ảnh')`, `dialog "Cắt ảnh đại diện"`, `slider "Thu phóng"`, phím mũi tên trên `img "Vùng cắt ảnh"`, `button "Lưu ảnh đại diện"`. Chờ xong theo điều kiện: dialog đóng + toast status "Đã cập nhật ảnh đại diện" (gỡ ⇒ "Đã gỡ ảnh đại diện"). Sau lưu (H 18/10): thẻ task (board) và `/account` ⇒ `img` alt = họ tên; header và trang thành viên avatar là trang trí (`alt=""`, `aria-hidden` — họ tên đã ở cạnh) ⇒ kiểm `locator('img[src*="/media/avatars/"]')` trong `navigation "Tài khoản"` (header) / trong `row` của người đó (trang thành viên ws là **bảng** — H 18/10: `getByRole('row', { name: /Họ tên/ }).locator('img[src*="/media/avatars/"]')`), **và** `getByRole('img', {name: họ tên})` không thấy ở hai chỗ này (không đọc 2 lần). Gỡ ⇒ không còn `img[src*="/media/avatars/"]` nào, quay về chữ cái. Cắt ảnh (H 18/10): ảnh luôn phủ kín khung ⇒ ảnh vuông ở zoom 1 **không dịch được** — tăng `slider "Thu phóng"` (hoặc `+` trên `img "Vùng cắt ảnh"`) trước khi bấm mũi tên, hoặc dùng ảnh ngang (chỉ dịch ngang); Shift+mũi tên ×5. Server mã hóa lại WebP ⇒ không so SHA với ảnh gốc |
| E2E-CH-02 | F | `chat.e2e.ts` | Vic mở 2 tab; Mia gửi ⇒ cả 2 tab hiện + badge; tab 1 đọc ⇒ badge 0 ở cả 2. Kéo dài > 10 s (đi qua `auth:renew` của socket) |
| E2E-CH-03 | F | `chat.e2e.ts` | Tạo nhóm qua `chat/people` (`q` riêng); kéo-thả ảnh; dán ảnh `@chromium-only`; `dialog "Xem ảnh"`; PDF ⇒ `button "Tải xuống <tên>"` ⇒ SHA-256 trùng tệp gửi; tên tệp tiếng Việt |
| E2E-CH-04 | F | `chat.e2e.ts` | Từ trang ws ⇒ phòng ws; OWNER bớt người ⇒ tab người đó: phòng biến mất khỏi danh sách (event hoặc lần tải kế) |
| E2E-CH-05 | F | `chat.e2e.ts` | `context.setOffline(true)` ⇒ gửi (lạc quan) ⇒ online ⇒ đúng 1 tin (không trùng), không "Gửi lại" kẹt |
| E2E-CH-06 | F | `chat.e2e.ts` | Seed 120 tin qua API ⇒ cuộn lên ⇒ tin đang nhìn giữ vị trí (|Δy| ≤ 8 px, như E2E-HR-14) |
| E2E-CH-07 | H | `chat.e2e.ts` | axe 0 serious / critical, sáng + tối, 360 / 1280; vùng `aria-live` chỉ đọc tin đến |
| SEC-CH-13 | H | `chat.e2e.ts` | §3 |

Selector chat: chờ H gửi (T-072). Thiết kế §7 E13: `link "Trò chuyện"`, `log "Tin nhắn"`, `textbox "Soạn tin"`, `button "Gửi"`, `button "Đính kèm"`, `dialog "Xem ảnh"`, `button "Tải xuống <tên>"`; `data-testid` chỉ `chat-message-<id>`, `upload-chip-<n>`.

## 7. Hiệu năng (tầng P — F; máy rảnh, ADR-107)

- `apps/api/test/perf/chat-seed.ts`: script DB seed 100 000 tin / 1 hội thoại, phòng ws 300 người, 50 hội thoại / người. **Chỉ tầng P**; DB riêng.
- `chat-perf.ts`: đo theo thiết kế §6 (p95 messages ≤ 150 ms; danh sách 50 hội thoại ≤ 200 ms; gửi → event ≤ 300 ms; upload 20 MB không chặn event loop > 50 ms qua `monitorEventLoopDelay`). Kết quả vào `docs/reviews/F-m6-perf-report.md`.

## 8. Stryker (tầng M — F, máy rảnh)

`chat/domain` + `core/files/domain` (+ phần đếm byte thuần của `rawUpload`) ≥ 90 %. Config `apps/api/stryker/chat-domain.config.mjs`, `files-domain.config.mjs`.

## 9. Kiểm kê theo file (cập nhật khi commit — F soát)

| File | Người viết | Mã ca | Trạng thái |
|---|---|---|---|
| `test/security/harness/upload.ts`, `files/fixtures.ts`, `files/store.ts`, `useCompanyApi` + env | F | harness | chưa |
| `e2e/support/chat.ts` + `apiServerEnv` | F | harness E | chưa |
| `chat-idor.sec.ts` | F | SEC-CH-01, 02, 03, 13 (S) | chưa |
| `chat-lifecycle.sec.ts` | F | SEC-CH-04, 28, 30 | chưa |
| `chat-clock-0559.sec.ts` | F | SEC-CH-05 / CLK-CH-01 | chưa |
| `chat-limits.sec.ts` | F | SEC-CH-14 | chưa |
| `chat-groups.sec.ts` | F | SEC-CH-15 | chưa |
| `chat-messages.sec.ts` | F | SEC-CH-16 | chưa |
| `chat-avatar.sec.ts` | F | SEC-CH-17 | chưa |
| `chat-people.sec.ts` | F | SEC-CH-18 | chưa |
| `chat-realtime.sec.ts` | F | SEC-CH-19 | chưa |
| `chat-logs.sec.ts` | F | SEC-CH-20 (API) | chưa |
| `chat-media.sec.ts` | F | SEC-CH-10, 11, 31, 35 (B); 22 (F) | chưa |
| `chat-media-rotate.sec.ts` | F | SEC-CH-35 (xoay khóa) | chưa |
| `chat-upload-types.sec.ts` | F | SEC-CH-06, 07, 12, 21, 23, 32, 33, 34, 36 | chưa |
| `chat-upload-limits.sec.ts` (NẶNG) | F | SEC-CH-08, 09, 24, 26, 27, 37; CC-CH-09 | chưa |
| `chat-races.sec.ts` | F | CC-CH-01, 02, 03, 05, 06 (F); 04, 07, 08 (B) | chưa |
| `chat-clock-avatar.sec.ts`, `chat-clock-retention.sec.ts` | F | CLK-CH-02, 03 | chưa |
| `e2e/specs/avatar.e2e.ts` | H | E2E-CH-01 | chưa |
| `e2e/specs/chat.e2e.ts` | F / H | E2E-CH-02…06 (F); 07, SEC-CH-13 (H) | chưa |
| unit / integration chat + files | G | AV-01…07, CH-01…16, SEC-CH-30 vế purge, SEC-CH-37 vế ổ đầy | chưa |
| `test/perf/chat-*` | F | P | chưa |
| `stryker/chat-domain`, `files-domain` | F | M | chưa |

Mọi mã ca ở thiết kế §5 / §6 có đúng một dòng ở bảng trên, trừ SEC-CH-25 (`outOfScope`, smoke Compose) và SEC-CH-29 (gộp). F kiểm bằng `git grep` mã ca sau mỗi lượt gộp.

## 10. Đã chốt (TL 1f, 2026-10-17)

1. **Người viết S / C:** G chỉ U / I. **F** viết quyền / IDOR / vòng đời / đua hội thoại **và** nhóm tệp / URL ký (+1,5 ngày); **B** soát bảo mật các ca đó; **H** viết E2E-CH-01 / 07, SEC-CH-13, Sentry web. §9 của `avatar-chat.md` sửa theo.
2. **Không route / cờ kích job:** env chỉ `APP_ENV=test` rút chu kỳ job (`MAINTENANCE_INTERVAL_MS`) + `TEST_CLOCK_ANCHOR`; không đủ ⇒ tầng I.
3. **Office thật:** LibreOffice headless + mẫu công khai; thiếu ⇒ pending có ghi chú.
4. `MEDIA_CORP`: F thêm một file S chạy `cross-origin` (`chat-media-corp.sec.ts`).
