import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { cleanupApp, renderWithProviders } from '@test/render';

import { RegisterPage } from '@/views/register';

describe('RegisterPage', () => {
  afterEach(cleanupApp);

  it('một h1, đủ 3 trường có nhãn, link sang đăng nhập, không vi phạm a11y', async () => {
    const { container } = renderWithProviders(<RegisterPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tạo tài khoản' })).toBeDefined();
    expect(screen.getByLabelText(/Họ tên/).getAttribute('autocomplete')).toBe('name');
    expect(screen.getByLabelText(/Email/).getAttribute('autocomplete')).toBe('email');
    expect(screen.getByLabelText(/Mật khẩu/).getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByRole('link', { name: 'Đăng nhập' }).getAttribute('href')).toBe('/login');
    await expectNoA11yViolations(container);
  });
});
