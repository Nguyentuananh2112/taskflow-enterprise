import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { cleanupApp, renderWithProviders } from '@test/render';

import { LoginPage } from '@/views/login';

describe('LoginPage', () => {
  afterEach(cleanupApp);

  it('một h1, form đăng nhập, link sang đăng ký, không vi phạm a11y', async () => {
    const { container } = renderWithProviders(<LoginPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Đăng ký' }).getAttribute('href')).toBe('/register');
    await expectNoA11yViolations(container);
  });
});
