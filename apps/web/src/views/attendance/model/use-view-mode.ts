import { useCallback, useSyncExternalStore } from 'react';

import { readLocal, writeLocal } from '@/shared/lib/storage';

// Lịch / Danh sách trên "Bảng công của tôi" (T-046): nhớ trong localStorage (wrapper try/catch). Storage lỗi ⇒ vẫn đổi
// được trong phiên (bộ nhớ). Server render luôn "Lịch" ⇒ không lệch hydrate (useSyncExternalStore + server snapshot).

export type ViewMode = 'calendar' | 'list';
const KEY = 'tf.attendance-view.v1';
let memory: ViewMode | null = null;
const listeners = new Set<() => void>();

const read = (): ViewMode => memory ?? (readLocal(KEY) === 'list' ? 'list' : 'calendar');
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const mode = useSyncExternalStore(subscribe, read, () => 'calendar' as const);
  const set = useCallback((next: ViewMode) => {
    memory = next;
    writeLocal(KEY, next);
    listeners.forEach((l) => l());
  }, []);
  return [mode, set];
}

export function resetViewModeForTest(): void {
  memory = null;
}
