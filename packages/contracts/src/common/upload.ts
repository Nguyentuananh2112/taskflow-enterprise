/**
 * Tải tệp lên (Mốc 6, ADR-141): body nhị phân `application/octet-stream`, tên gốc trong header bắt buộc
 * `X-Upload-Name` = `encodeURIComponent(name)` (≤ 255 byte UTF-8 sau giải mã). Hằng số dùng chung FE/BE —
 * web kiểm trước phía client, server vẫn kiểm lại.
 */
export const UPLOAD_NAME_HEADER = 'X-Upload-Name';
export const UPLOAD_CONTENT_TYPE = 'application/octet-stream';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CHAT_MAX_ATTACHMENTS = 10;
