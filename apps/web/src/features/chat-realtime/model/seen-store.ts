import { useSyncExternalStore } from 'react';

// "Đã xem" ở DIRECT (avatar-chat.md §7 E8): con trỏ đọc của NGƯỜI KHÁC, từ `chat:read`. Chỉ tiến (server đã đảm bảo).

const seen = new Map<string, ReadonlyMap<string, string>>();
const listeners = new Set<() => void>();
const NONE: ReadonlyMap<string, string> = new Map();

export const seenStore = {
  set(convId: string, userId: string, messageId: string): void {
    const next = new Map(seen.get(convId) ?? NONE);
    next.set(userId, messageId);
    seen.set(convId, next);
    listeners.forEach((l) => l());
  },
  reset(): void {
    seen.clear();
    listeners.forEach((l) => l());
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: (convId: string): ReadonlyMap<string, string> => seen.get(convId) ?? NONE,
};

/** userId ⇒ id tin cuối người đó đã đọc, trong hội thoại này. */
export function useSeenBy(convId: string): ReadonlyMap<string, string> {
  return useSyncExternalStore(
    seenStore.subscribe,
    () => seenStore.get(convId),
    () => NONE,
  );
}
