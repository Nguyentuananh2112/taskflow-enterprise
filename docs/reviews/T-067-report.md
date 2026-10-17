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
3. **Ảnh hỏng / sharp lỗi / quá 10 s** ⇒ 422 `BUSINESS_RULE_VIOLATION` với `details.rule = IMAGE_UNREADABLE`
   (thêm vào `BusinessRule` của contracts; test parity `test/contract/files-parity.test.ts`).

Khác (đã thống nhất với F): env chỉ cho `APP_ENV=test` là `FILES_SWEEP_ON_START`, `FILES_SWEEP_INTERVAL_MS`
(≥ 1 s), `FILES_IMAGE_PIPELINE_DISABLED`. `MEDIA_CORP` là env thường.

## Đã làm

| Bước | Commit | Nội dung |
|---|---|---|
| 1 | 52cee43 | `core/files/domain`: `sniffType`, `inspectZip` (central directory, trần 2 000 entry, bung ≤ 1 MB, chặn macro / externalLink / OLE / ActiveX / ODF `Basic/` `Scripts/`), `detectTextEncoding` (UTF-8 ± BOM, UTF-16 BOM, Windows-1258), `decodeUploadName`, `sanitizeFileName`, `attachmentDisposition`, `file-key`, `media-signature` (tuple v1, `_PREVIOUS`, `bucketExpiry`) |
| 2 | cccdbe8 | `ports.ts` + `LocalFileStore` / `LocalStagedFile`; 6 ErrorCode mới + lớp lỗi |
| — | 50b3200 | CH-03 đối chiếu fixtures của F (48 ca) |
| — | 6c70353 | rule `IMAGE_UNREADABLE` + parity |

## Còn lại
3 `rawUpload` + ngoại lệ content-type · 4 worker sharp · 5 `/media` · 6 env · 7 `files-sweep` · 8 compose
volume + runbook backup tệp · 9 ca SEC-CH của G.

## Soát của B (18/10) — đã xử lý

- **M-a** `commit` KHÔNG ghi đè: hard link `tmp → đích` rồi bỏ tmp; đích đã có ⇒ `FileExistsError` (không thử
  lại). Test đua hai upload cùng khóa avatar: đúng một thắng, blob nguyên vẹn, không sót tmp. Phần (i) —
  cấp `avatar_version` bằng `UPDATE … RETURNING` dưới khóa dòng TRƯỚC khi commit blob — làm ở **T-068**.
- **M-b** `STALE_TEMP_AGE_MS` = 1 giờ (≥ 2 × (180 s + 10 s), có test); bản tạm mất trước commit ⇒ 503
  `SERVICE_UNAVAILABLE` có kiểm soát.
- **L-a** `forbiddenParents` so sau `realpath` (test junction).
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

- TL/E: worker sharp quá 10 s nên là rule riêng `IMAGE_TOO_COMPLEX` ("chọn ảnh nhỏ hơn") hay dùng chung
  `IMAGE_UNREADABLE` + log phân biệt (đề xuất của B)?
