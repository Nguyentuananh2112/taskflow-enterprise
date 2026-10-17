import { CLIENT_ERROR_CODES, isApiError } from '@/shared/api';

import { AvatarImageError } from './image';

// Lỗi bằng lời thường (avatar-chat.md §7 E5) — không lộ mã kỹ thuật, nói người dùng làm gì tiếp.

export const UNREADABLE = 'Ảnh này chưa đọc được, hãy chọn ảnh JPG hoặc PNG.';

/** Mã lỗi server (gồm mã mới chưa có trong ErrorCode — `serverCode`) ⇒ câu cho người dùng. */
const BY_CODE: Readonly<Record<string, string>> = {
  UNSUPPORTED_FILE_TYPE: UNREADABLE,
  UNSUPPORTED_MEDIA_TYPE: UNREADABLE,
  PAYLOAD_TOO_LARGE: 'Ảnh lớn quá, hãy chọn ảnh nhỏ hơn.',
  INVALID_UPLOAD_NAME: 'Không gửi được ảnh, hãy thử lại.',
  RATE_LIMITED: 'Bạn vừa đổi ảnh nhiều lần, hãy thử lại sau ít phút.',
  IMAGE_PROCESSING_BUSY: 'Máy chủ đang bận xử lý ảnh, hãy thử lại sau vài giây.',
  IMAGE_PROCESSING_UNAVAILABLE: 'Tạm thời chưa đổi được ảnh đại diện, hãy thử lại sau.',
  STORAGE_FULL: 'Kho lưu trữ đã đầy — hãy báo quản trị viên.',
  [CLIENT_ERROR_CODES.network]: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
};

/** 422 BUSINESS_RULE_VIOLATION của xử lý ảnh (G/TL chốt) — phân biệt bằng `details.rule`. */
const BY_RULE: Readonly<Record<string, string>> = {
  IMAGE_UNREADABLE: 'Ảnh này chưa đọc được, hãy chọn ảnh JPG hoặc PNG khác.',
  IMAGE_TOO_COMPLEX: 'Ảnh quá lớn hoặc phức tạp, hãy chọn ảnh nhỏ hơn.',
};

const ruleOf = (details: unknown): string | undefined =>
  typeof details === 'object' && details !== null && 'rule' in details
    ? String(details.rule)
    : undefined;

export function avatarErrorMessage(error: unknown): string {
  if (error instanceof AvatarImageError) {
    return error.reason === 'size' ? 'Ảnh lớn quá (tối đa 20 MB), hãy chọn ảnh khác.' : UNREADABLE;
  }
  if (isApiError(error)) {
    const rule = ruleOf(error.details);
    if (error.code === 'BUSINESS_RULE_VIOLATION' && rule && BY_RULE[rule]) return BY_RULE[rule];
    return BY_CODE[error.serverCode ?? error.code] ?? 'Chưa lưu được ảnh, hãy thử lại.';
  }
  return 'Chưa lưu được ảnh, hãy thử lại.';
}
