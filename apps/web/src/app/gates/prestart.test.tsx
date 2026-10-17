import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupApp } from '@test/render';

import { session } from '@/entities/session';

import { AppProviders } from '../providers';
import { AuthGate } from './auth-gate';
import { GuestGate } from './guest-gate';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-044 S2a: khôi phục phiên mở NGAY ở lượt render của gate (trước effect `bootstrap`), và CHỈ ở route có gate —
// landing `/` và trang 404 (AppProviders không có gate) không gửi /auth/refresh (review E: không xoay refresh token,
// không tốn hạn mức refresh khi trang không cần phiên).

const CONFIG = {
  apiUrl: 'http://localhost:4000/api/v1',
  wsUrl: 'http://localhost:4000',
  appEnv: 'test' as const,
};

afterEach(() => {
  vi.restoreAllMocks();
  cleanupApp();
});

describe('session.prestart từ gate', () => {
  it.each([
    ['AuthGate', AuthGate],
    ['GuestGate', GuestGate],
  ])('%s gọi prestart TRONG render, trước bootstrap (effect)', (_name, Gate) => {
    const calls: string[] = [];
    vi.spyOn(session, 'prestart').mockImplementation(() => void calls.push('prestart'));
    vi.spyOn(session, 'bootstrap').mockImplementation(() => {
      calls.push('bootstrap');
      return Promise.resolve();
    });
    render(
      <AppProviders config={CONFIG} nonce={undefined}>
        <Gate>
          <p>nội dung</p>
        </Gate>
      </AppProviders>,
    );
    expect(calls[0]).toBe('prestart');
    expect(calls).toContain('bootstrap');
  });

  it('AppProviders KHÔNG có gate (landing / 404) ⇒ không prestart, không bootstrap', () => {
    const prestart = vi.spyOn(session, 'prestart');
    const bootstrap = vi.spyOn(session, 'bootstrap');
    render(
      <AppProviders config={CONFIG} nonce={undefined}>
        <p>landing</p>
      </AppProviders>,
    );
    expect(prestart).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
  });
});
