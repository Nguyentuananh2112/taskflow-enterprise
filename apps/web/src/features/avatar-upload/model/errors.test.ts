import { describe, expect, it } from 'vitest';

import { ApiError, CLIENT_ERROR_CODES } from '@/shared/api';

import { UNREADABLE, avatarErrorMessage } from './errors';
import { AvatarImageError } from './image';

const api = (status: number, code: string, details: unknown = null, serverCode?: string) =>
  new ApiError({
    status,
    code: code as never,
    message: 'x',
    details,
    ...(serverCode ? { serverCode } : {}),
  });

describe('avatarErrorMessage — lời thường (§7 E5)', () => {
  it('lỗi phía trình duyệt: loại / giải mã ⇒ "chưa đọc được"; quá 20 MB ⇒ lớn quá', () => {
    expect(avatarErrorMessage(new AvatarImageError('type'))).toBe(UNREADABLE);
    expect(avatarErrorMessage(new AvatarImageError('decode'))).toBe(UNREADABLE);
    expect(avatarErrorMessage(new AvatarImageError('size'))).toContain('20 MB');
  });

  it('422 BUSINESS_RULE_VIOLATION theo details.rule (G/TL chốt)', () => {
    expect(
      avatarErrorMessage(api(422, 'BUSINESS_RULE_VIOLATION', { rule: 'IMAGE_UNREADABLE' })),
    ).toBe('Ảnh này chưa đọc được, hãy chọn ảnh JPG hoặc PNG khác.');
    expect(
      avatarErrorMessage(api(422, 'BUSINESS_RULE_VIOLATION', { rule: 'IMAGE_TOO_COMPLEX' })),
    ).toBe('Ảnh quá lớn hoặc phức tạp, hãy chọn ảnh nhỏ hơn.');
    expect(avatarErrorMessage(api(422, 'BUSINESS_RULE_VIOLATION', { rule: 'OTHER' }))).toBe(
      'Chưa lưu được ảnh, hãy thử lại.',
    );
  });

  it('mã đã có trong ErrorCode và mã mới (serverCode)', () => {
    expect(avatarErrorMessage(api(413, 'PAYLOAD_TOO_LARGE'))).toBe(
      'Ảnh lớn quá, hãy chọn ảnh nhỏ hơn.',
    );
    expect(avatarErrorMessage(api(429, 'RATE_LIMITED'))).toContain('thử lại sau ít phút');
    expect(
      avatarErrorMessage(api(507, CLIENT_ERROR_CODES.unknown, null, 'STORAGE_FULL')),
    ).toContain('quản trị viên');
    expect(
      avatarErrorMessage(api(415, CLIENT_ERROR_CODES.unknown, null, 'UNSUPPORTED_FILE_TYPE')),
    ).toBe(UNREADABLE);
    expect(avatarErrorMessage(api(0, CLIENT_ERROR_CODES.network))).toContain('Kiểm tra mạng');
    expect(avatarErrorMessage(new Error('?'))).toBe('Chưa lưu được ảnh, hãy thử lại.');
  });
});
