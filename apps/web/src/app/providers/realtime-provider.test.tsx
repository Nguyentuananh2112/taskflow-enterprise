import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeRealtimeHub } from '@test/fake-realtime';
import { cleanupApp } from '@test/render';

import { session } from '@/entities/session';
import { useRealtimeStatus } from '@/shared/socket';

import { RealtimeProvider } from './realtime-provider';

// Vòng đời socket theo phiên (frontend.md §3.5): tạo sau đăng nhập, `auth:renew` khi có token mới,
// ngắt khi phiên kết thúc.

const USER = {
  id: '0199e5a2-0000-7000-8000-0000000000a1',
  email: 'lan@example.com',
  fullName: 'Trần Lan',
  createdAt: '2026-10-15T08:00:00.000Z',
};

function Status() {
  return <p>{useRealtimeStatus()}</p>;
}

afterEach(() => cleanupApp());

describe('RealtimeProvider', () => {
  it('khách ⇒ không tạo socket; đăng nhập ⇒ connect; token mới ⇒ auth:renew; đăng xuất ⇒ ngắt', async () => {
    const client = new FakeRealtimeHub().client();
    const factory = vi.fn(() => client);
    const view = render(
      <RealtimeProvider createClient={factory}>
        <Status />
      </RealtimeProvider>,
    );
    expect(factory).not.toHaveBeenCalled();
    expect(view.getByText('offline')).toBeTruthy();

    act(() => session.signIn({ accessToken: 'access-1', expiresIn: 900 }, USER));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(view.getByText('connected')).toBeTruthy();

    act(() => session.replaceToken({ accessToken: 'access-2', expiresIn: 900 }));
    expect(client.renewLog).toEqual(['access-2']);

    // logout luôn kết thúc phiên kể cả khi request lỗi (ở đây chưa có runtime config ⇒ request lỗi).
    await act(() => session.logout());
    expect(client.status()).toBe('offline');
  });

  it('mất kết nối rồi trình duyệt báo "online" ⇒ thử nối lại (T-044 S1: chunk socket có thể đã tải lỗi)', () => {
    const client = new FakeRealtimeHub().client();
    render(
      <RealtimeProvider createClient={() => client}>
        <Status />
      </RealtimeProvider>,
    );
    act(() => session.signIn({ accessToken: 'access-1', expiresIn: 900 }, USER));
    expect(client.status()).toBe('connected');
    act(() => client.drop());
    expect(client.status()).toBe('reconnecting');
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(client.status()).toBe('connected');
  });
});
