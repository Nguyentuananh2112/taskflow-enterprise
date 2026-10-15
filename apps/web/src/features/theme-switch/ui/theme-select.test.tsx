import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { readLocal, removeLocal, writeLocal } from '@/shared/lib/storage';
import { THEME_KEY } from '@/shared/lib/theme';

import { ThemeSelect } from './theme-select';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  removeLocal(THEME_KEY);
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ThemeSelect', () => {
  it('mặc định "Theo hệ thống"; chọn Tối ⇒ áp ngay + nhớ; a11y', async () => {
    render(<ThemeSelect />);
    const select = screen.getByRole('combobox', { name: 'Giao diện' });
    expect(select).toHaveProperty('value', 'system');
    await expectNoA11yViolations();
    await userEvent.setup({ delay: null }).selectOptions(select, 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(readLocal(THEME_KEY)).toBe('dark');
    expect(select).toHaveProperty('value', 'dark');
  });

  it('đọc lại lựa chọn đã lưu', () => {
    writeLocal(THEME_KEY, 'light');
    render(<ThemeSelect />);
    expect(screen.getByRole('combobox', { name: 'Giao diện' })).toHaveProperty('value', 'light');
  });
});
