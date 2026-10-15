import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  THEME_BOOT_SCRIPT,
  THEME_KEY,
  readThemePref,
  resolveTheme,
  setThemePref,
  useThemeSync,
} from './theme';
import { readLocal, removeLocal, writeLocal } from './storage';

// frontend.md §6.1: Sáng/Tối/Hệ thống, lưu localStorage, `data-theme` luôn được đặt trên <html>.

let systemDark = false;
const mediaListeners = new Set<() => void>();

beforeEach(() => {
  systemDark = false;
  mediaListeners.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return systemDark;
      },
      addEventListener: (_: string, l: () => void) => mediaListeners.add(l),
      removeEventListener: (_: string, l: () => void) => mediaListeners.delete(l),
    })),
  );
  removeLocal(THEME_KEY);
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const theme = () => document.documentElement.getAttribute('data-theme');
// Chạy đúng chuỗi script được nhúng vào <head> (không phải bản sao logic).
// eslint-disable-next-line @typescript-eslint/no-implied-eval -- test chạy chính script inline của layout
const runBootScript = () => (new Function(THEME_BOOT_SCRIPT) as () => void)();

describe('theme', () => {
  it('mặc định / giá trị lạ / storage bị chặn ⇒ "system"', () => {
    expect(readThemePref()).toBe('system');
    writeLocal(THEME_KEY, 'tím');
    expect(readThemePref()).toBe('system');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readThemePref()).toBe('system');
  });

  it('resolveTheme: system theo HĐH, light/dark cố định', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('setThemePref lưu lựa chọn + đặt data-theme; storage ghi lỗi vẫn áp được', () => {
    setThemePref('dark');
    expect(readLocal(THEME_KEY)).toBe('dark');
    expect(theme()).toBe('dark');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    setThemePref('light');
    expect(theme()).toBe('light');
  });

  it.each([
    ['không lưu gì, HĐH sáng', null, false, 'light'],
    ['không lưu gì, HĐH tối', null, true, 'dark'],
    ['chọn Tối, HĐH sáng', 'dark', false, 'dark'],
    ['chọn Sáng, HĐH tối', 'light', true, 'light'],
    ['giá trị lạ, HĐH tối', '"><script>', true, 'dark'],
  ])('script khởi động (trước paint): %s ⇒ %s', (_label, stored, dark, expected) => {
    if (stored !== null) writeLocal(THEME_KEY, stored);
    systemDark = dark;
    runBootScript();
    expect(theme()).toBe(expected);
  });

  it(`script khởi động không chứa ký tự React escape trong text (" & ' < >) ⇒ nhúng nguyên văn`, () => {
    expect(THEME_BOOT_SCRIPT).not.toMatch(/["&'<>]/);
  });

  it('script khởi động: storage ném lỗi ⇒ vẫn đặt theo HĐH, không ném', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    systemDark = true;
    expect(runBootScript).not.toThrow();
    expect(theme()).toBe('dark');
  });

  it('useThemeSync: chế độ Hệ thống đổi theo HĐH; đã chọn Sáng thì không đổi', () => {
    renderHook(() => useThemeSync());
    setThemePref('system');
    expect(theme()).toBe('light');
    systemDark = true;
    mediaListeners.forEach((l) => l());
    expect(theme()).toBe('dark');
    setThemePref('light');
    mediaListeners.forEach((l) => l());
    expect(theme()).toBe('light');
  });

  it('useThemeSync: tab khác đổi lựa chọn (sự kiện storage) ⇒ áp ngay', () => {
    renderHook(() => useThemeSync());
    writeLocal(THEME_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY }));
    expect(theme()).toBe('dark');
  });
});
