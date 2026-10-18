import { useSyncExternalStore } from 'react';

/**
 * `matchMedia(query).matches`, theo dõi khi đổi cỡ màn — để render MỘT trong hai bố cục (không nhân đôi nút / nhãn
 * a11y như khi ẩn bằng CSS). Không có `matchMedia` (SSR, jsdom) ⇒ `fallback`.
 */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
        return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}
