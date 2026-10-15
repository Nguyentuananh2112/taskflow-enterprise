import { useEffect, useState } from 'react';

/** Giá trị trễ `ms` sau lần đổi cuối (ô tìm kiếm gọi server — frontend.md §1.6: 300ms). */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
