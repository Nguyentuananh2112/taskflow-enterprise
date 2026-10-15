// Phần THUẦN của theme (không hook React) — root layout (Server Component) import được.

export type ThemePref = 'light' | 'dark' | 'system';
export const THEME_KEY = 'tf-theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Chạy inline trong <head> TRƯỚC khi paint (root layout render `<script nonce>` với nội dung là TEXT —
 * không dangerouslySetInnerHTML). React escape `" & ' < >` trong text ⇒ script KHÔNG được chứa các ký tự
 * đó: chuỗi dùng backtick, không `&&` (if lồng). Không dùng import/biến ngoài; lỗi storage ⇒ Hệ thống.
 * Giữ đồng bộ với `readThemePref` + `applyTheme` (theme.ts) — test chạy chính chuỗi này.
 */
export const THEME_BOOT_SCRIPT = [
  '(function(){var p;try{p=localStorage.getItem(`' + THEME_KEY + '`)}catch(e){}',
  'if(p!==`light`)if(p!==`dark`)p=`system`;',
  'var d=p===`dark`;',
  'if(p===`system`)if(typeof matchMedia===`function`)d=matchMedia(`' + DARK_QUERY + '`).matches;',
  'document.documentElement.setAttribute(`data-theme`,d?`dark`:`light`)})();',
].join('');
