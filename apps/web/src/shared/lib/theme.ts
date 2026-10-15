import { useEffect, useSyncExternalStore } from 'react';

import { readLocal, writeLocal } from './storage';
import { DARK_QUERY, THEME_KEY, type ThemePref } from './theme-boot';

export { THEME_BOOT_SCRIPT, THEME_KEY, type ThemePref } from './theme-boot';

// Theme Sáng/Tối/Hệ thống (frontend.md §6.1). MỘT cơ chế: thuộc tính `data-theme="light|dark"` trên
// <html>, luôn được đặt (kể cả chế độ Hệ thống — tính từ prefers-color-scheme). Lựa chọn lưu localStorage
// (không nhạy cảm). Script khởi động (theme-boot.ts) chạy TRƯỚC khi paint (root layout, nonce CSP).

const isPref = (value: unknown): value is ThemePref =>
  value === 'light' || value === 'dark' || value === 'system';

export function readThemePref(): ThemePref {
  const stored = readLocal(THEME_KEY);
  return isPref(stored) ? stored : 'system';
}

const prefersDark = () =>
  typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;

export function resolveTheme(pref: ThemePref, systemDark: boolean): 'light' | 'dark' {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(pref, prefersDark()));
}

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function setThemePref(pref: ThemePref): void {
  writeLocal(THEME_KEY, pref);
  applyTheme(pref);
  listeners.forEach((listener) => listener());
}

/** Lựa chọn hiện tại; khi render phía server trả 'system' (đồng bộ lại sau hydrate). */
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, readThemePref, () => 'system');
}

/**
 * Đặt một lần ở gốc app: chế độ Hệ thống theo dõi đổi giao diện của HĐH; tab khác đổi lựa chọn (sự kiện
 * `storage`) ⇒ áp ngay ở tab này.
 */
export function useThemeSync(): void {
  useEffect(() => {
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
    const onSystem = () => {
      if (readThemePref() === 'system') applyTheme('system');
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY) return;
      applyTheme(readThemePref());
      listeners.forEach((listener) => listener());
    };
    media?.addEventListener('change', onSystem);
    window.addEventListener('storage', onStorage);
    return () => {
      media?.removeEventListener('change', onSystem);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
}
