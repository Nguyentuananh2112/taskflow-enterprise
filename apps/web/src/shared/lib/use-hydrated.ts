import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => undefined;

/** `false` trong HTML do server render và lúc hydrate, `true` khi React đã chạy ở client. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
