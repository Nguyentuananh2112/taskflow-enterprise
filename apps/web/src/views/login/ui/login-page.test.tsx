import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { Toaster, resetToastsForTest } from '@/shared/ui/toast';
import { LoginPage } from '@/views/login';

describe('LoginPage (placeholder T-012)', () => {
  afterEach(() => {
    cleanup();
    act(() => resetToastsForTest());
  });

  it('có h1, ô email/mật khẩu có nhãn, autocomplete đúng, không vi phạm a11y', async () => {
    const { container } = render(<LoginPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeDefined();
    expect(screen.getByLabelText(/Email/).getAttribute('autocomplete')).toBe('email');
    const password = screen.getByLabelText(/Mật khẩu/);
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(password.getAttribute('minlength')).toBe('12');
    await expectNoA11yViolations(container);
  });

  it('submit ⇒ toast báo chưa hỗ trợ (chưa gọi API ở T-012)', () => {
    render(
      <>
        <LoginPage />
        <Toaster />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(screen.getByText('Chưa hỗ trợ')).toBeDefined();
  });

  it('"Quên mật khẩu?" mở dialog giải thích', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Quên mật khẩu?' }));
    expect(screen.getByRole('dialog', { name: 'Quên mật khẩu?' })).toBeDefined();
  });
});
