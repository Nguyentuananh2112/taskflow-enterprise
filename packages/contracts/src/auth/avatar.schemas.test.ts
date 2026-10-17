import { describe, expect, it } from 'vitest';

import {
  AVATAR_MAX_BYTES,
  AvatarUploadResponseDto,
  CHAT_FILE_MAX_BYTES,
  CHAT_MAX_ATTACHMENTS,
  EmployeeDto,
  REALTIME_EVENTS,
  UPLOAD_NAME_HEADER,
  UserAvatarChangedEventDto,
  UserDto,
  UserRefDto,
} from '../index';

// Mốc 6 — contract ảnh đại diện (ADR-141/142, thống nhất G ↔ H 17/10).
const ID = '0b6f2c1e-7f6a-4c1d-9a3e-2b1c0d9e8f7a';
const URL64 = `https://api.example.test/api/v1/media/avatars/${ID}/64?v=2&exp=1760000000&sig=${'a'.repeat(43)}`;
const URL256 = URL64.replace('/64?', '/256?');

describe('avatar trong DTO người dùng', () => {
  it('UserRefDto: avatarUrl tùy chọn, null được (người đã nghỉ / chưa có ảnh)', () => {
    expect(UserRefDto.parse({ id: ID, fullName: 'Mia' })).toEqual({ id: ID, fullName: 'Mia' });
    expect(UserRefDto.parse({ id: ID, fullName: 'Mia', avatarUrl: null }).avatarUrl).toBeNull();
    expect(UserRefDto.parse({ id: ID, fullName: 'Mia', avatarUrl: URL64 }).avatarUrl).toBe(URL64);
  });

  it('UserRefDto: avatarUrl không phải URL http(s) ⇒ sai (javascript:, chuỗi tương đối)', () => {
    for (const bad of [
      'javascript:alert(1)',
      '/api/v1/media/avatars/x/64',
      'data:image/png;base64,AA',
    ]) {
      expect(UserRefDto.safeParse({ id: ID, fullName: 'Mia', avatarUrl: bad }).success).toBe(false);
    }
  });

  it('UserDto (MeResponse.user / LoginResponse.user / PATCH me): avatarUrl + avatarUrlLarge', () => {
    const user = {
      id: ID,
      email: 'mia@example.test',
      fullName: 'Mia',
      createdAt: '2026-10-17T08:00:00.000Z',
    };
    expect(UserDto.safeParse(user).success).toBe(true);
    const withAvatar = UserDto.parse({ ...user, avatarUrl: URL64, avatarUrlLarge: URL256 });
    expect([withAvatar.avatarUrl, withAvatar.avatarUrlLarge]).toEqual([URL64, URL256]);
    expect(
      UserDto.parse({ ...user, avatarUrl: null, avatarUrlLarge: null }).avatarUrlLarge,
    ).toBeNull();
  });

  it('EmployeeDto: avatarUrl tùy chọn (web hiện nút "Gỡ ảnh đại diện" khi có)', () => {
    const employee = {
      userId: ID,
      fullName: 'Mia',
      email: 'mia@example.test',
      status: 'ACTIVE',
      grants: [],
      startDate: '2026-01-05',
      offboardLastDay: null,
      version: 1,
    };
    expect(EmployeeDto.safeParse(employee).success).toBe(true);
    expect(EmployeeDto.parse({ ...employee, avatarUrl: URL64 }).avatarUrl).toBe(URL64);
  });

  it('AvatarUploadResponseDto: cả hai URL bắt buộc', () => {
    expect(
      AvatarUploadResponseDto.safeParse({ avatarUrl: URL64, avatarUrlLarge: URL256 }).success,
    ).toBe(true);
    expect(AvatarUploadResponseDto.safeParse({ avatarUrl: URL64 }).success).toBe(false);
  });
});

describe('user:avatar-changed', () => {
  const envelope = (data: unknown) => ({
    eventId: ID,
    type: 'user:avatar-changed',
    occurredAt: '2026-10-17T08:00:00.000Z',
    actorId: ID,
    originClientId: null,
    data,
  });

  it('tên event + payload {userId, avatarUrl | null}', () => {
    expect(REALTIME_EVENTS.userAvatarChanged).toBe('user:avatar-changed');
    expect(
      UserAvatarChangedEventDto.safeParse(envelope({ userId: ID, avatarUrl: URL64 })).success,
    ).toBe(true);
    expect(
      UserAvatarChangedEventDto.safeParse(envelope({ userId: ID, avatarUrl: null })).success,
    ).toBe(true);
    expect(UserAvatarChangedEventDto.safeParse(envelope({ userId: ID })).success).toBe(false);
  });
});

describe('hằng số tải lên (ADR-141)', () => {
  it('giới hạn người dùng chốt 17/10', () => {
    expect(UPLOAD_NAME_HEADER).toBe('X-Upload-Name');
    expect(AVATAR_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(CHAT_FILE_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(CHAT_MAX_ATTACHMENTS).toBe(10);
  });
});
