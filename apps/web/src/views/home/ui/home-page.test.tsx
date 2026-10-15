import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { HomePage } from '@/views/home';

describe('HomePage', () => {
  afterEach(cleanup);

  it('hiển thị tiêu đề ứng dụng', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'TaskFlow' })).toBeDefined();
  });

  it('có link Đăng nhập tới /login và không vi phạm a11y', async () => {
    const { container } = render(<HomePage />);
    expect(screen.getByRole('link', { name: 'Đăng nhập' }).getAttribute('href')).toBe('/login');
    await expectNoA11yViolations(container);
  });
});
