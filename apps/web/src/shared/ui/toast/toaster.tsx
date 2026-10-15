'use client';

import { Toast } from 'radix-ui';
import { useSyncExternalStore } from 'react';

import { cn } from '@/shared/lib/cn';

import { dismissToast, toastStore, type ToastTone } from './toast-store';

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'border-l-primary',
  success: 'border-l-success',
  error: 'border-l-danger',
};

const EMPTY: never[] = [];
const noopSubscribe = () => () => undefined;

/**
 * Đặt MỘT lần ở src/app/providers. Radix Toast lo aria-live, F8 để nhảy tới vùng thông báo, vuốt để đóng.
 * CHỈ render ở client: Radix gắn `style="pointer-events:none"` lên vùng thông báo; nếu có trong HTML do
 * server render thì bị CSP style-src chặn (W-CSP-2) và vùng rỗng sẽ chặn click. Render ở client thì
 * React gán style qua CSSOM — không bị chặn.
 */
export function Toaster() {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, () => EMPTY);
  if (!mounted) return null;
  return (
    <Toast.Provider label="Thông báo" swipeDirection="right">
      {items.map((t) => (
        <Toast.Root
          key={t.id}
          duration={t.duration}
          // Lỗi đọc ngay (assertive); còn lại không ngắt lời người dùng.
          type={t.tone === 'error' ? 'foreground' : 'background'}
          onOpenChange={(open) => {
            if (!open) dismissToast(t.id);
          }}
          className={cn(
            'flex items-start gap-3 rounded-card border border-l-4 border-border bg-surface p-3 text-text shadow-raised',
            TONE_CLASS[t.tone],
          )}
        >
          <div className="flex flex-1 flex-col gap-0.5">
            <Toast.Title className="text-sm font-semibold">{t.title}</Toast.Title>
            {t.description && (
              <Toast.Description className="text-sm text-text-muted">
                {t.description}
              </Toast.Description>
            )}
          </div>
          <Toast.Close
            aria-label="Đóng thông báo"
            className="inline-flex size-6 items-center justify-center rounded-control text-text-muted hover:bg-bg-subtle"
          >
            <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </Toast.Close>
        </Toast.Root>
      ))}
      <Toast.Viewport
        label="Thông báo ({hotkey})"
        // Vùng rỗng không được chặn click; từng thông báo bật lại pointer-events.
        className="pointer-events-none fixed bottom-0 right-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none [&>*]:pointer-events-auto"
      />
    </Toast.Provider>
  );
}
