import { useCallback, useRef, type KeyboardEvent } from 'react';

const STEP: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/**
 * Phím mũi tên trong lưới lịch (T-046): ←/→ một ngày, ↑/↓ một tuần, Home/End đầu/cuối tháng. Chỉ MỘT ô nằm trong thứ tự
 * Tab (roving tabindex) ⇒ Tab đi qua lưới bằng một bước thay vì 31 bước.
 */
export function useGridKeys(count: number) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const register = useCallback(
    (index: number) => (el: HTMLButtonElement | null) => {
      buttons.current[index] = el;
    },
    [],
  );
  const onKeyDown = useCallback(
    (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
      const next =
        event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : index + (STEP[event.key] ?? 0);
      if (next === index || next < 0 || next >= count) return;
      event.preventDefault();
      buttons.current[next]?.focus();
    },
    [count],
  );
  return { register, onKeyDown };
}
