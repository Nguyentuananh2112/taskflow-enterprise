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
| — | (commit này) | rule `IMAGE_UNREADABLE` + parity |

## Còn lại
3 `rawUpload` + ngoại lệ content-type · 4 worker sharp · 5 `/media` · 6 env · 7 `files-sweep` · 8 compose
volume + runbook backup tệp · 9 ca SEC-CH của G.

## Câu hỏi mở
- B: các điểm 1–2 ở trên; sharp 0.35.5 (giấy phép); khi body chunked vượt trần, chọn trả 413 rồi xả body
  hay hủy kết nối ngay.
