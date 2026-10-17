import { useSyncExternalStore } from 'react';

// "Đang gõ" (avatar-chat.md ADR-145, §7): server phát ≤ 1 / 3 s / người ⇒ hiện tối đa TYPING_TTL_MS sau lần cuối, rồi tự
// tắt. Tin của người đó đến ⇒ tắt ngay. Chỉ trong bộ nhớ, không vào cache query.

export const TYPING_TTL_MS = 5_000;

type Entry = { until: number; timer: ReturnType<typeof setTimeout> };

const byConversation = new Map<string, Map<string, Entry>>();
const listeners = new Set<() => void>();
const EMPTY: readonly string[] = Object.freeze([]);
let snapshots = new Map<string, readonly string[]>();

function publish(convId: string) {
  snapshots = new Map(snapshots);
  snapshots.set(convId, [...(byConversation.get(convId)?.keys() ?? [])]);
  listeners.forEach((l) => l());
}

export const typingStore = {
  start(convId: string, userId: string, now: number = Date.now()): void {
    const users = byConversation.get(convId) ?? new Map<string, Entry>();
    clearTimeout(users.get(userId)?.timer);
    users.set(userId, {
      until: now + TYPING_TTL_MS,
      timer: setTimeout(() => typingStore.stop(convId, userId), TYPING_TTL_MS),
    });
    byConversation.set(convId, users);
    publish(convId);
  },
  stop(convId: string, userId: string): void {
    const users = byConversation.get(convId);
    const entry = users?.get(userId);
    if (!users || !entry) return;
    clearTimeout(entry.timer);
    users.delete(userId);
    publish(convId);
  },
  /** Đăng xuất / test. */
  reset(): void {
    byConversation.forEach((users) => users.forEach((e) => clearTimeout(e.timer)));
    byConversation.clear();
    snapshots = new Map();
    listeners.forEach((l) => l());
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: (convId: string): readonly string[] => snapshots.get(convId) ?? EMPTY,
};

/** id người đang gõ ở hội thoại này (không gồm chính mình — server không phát lại cho người gõ). */
export function useTypingUsers(convId: string): readonly string[] {
  return useSyncExternalStore(
    typingStore.subscribe,
    () => typingStore.get(convId),
    () => EMPTY,
  );
}
