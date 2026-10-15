// Store thông báo toàn cục: gọi `toast(...)` từ bất kỳ đâu (hook mutation, http error handler),
// <Toaster /> ở src/app/providers render. Thay `sonner` vì sonner chèn <style> không nonce ⇒ bị CSP chặn.

export type ToastTone = 'info' | 'success' | 'error';

export type ToastInput = Readonly<{
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms; mặc định 5000, lỗi 8000 (đủ thời gian đọc). */
  duration?: number;
}>;

export type ToastItem = Required<Pick<ToastInput, 'title' | 'tone' | 'duration'>> &
  Pick<ToastInput, 'description'> & { readonly id: number };

const MAX_VISIBLE = 3;

let items: readonly ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function toast(input: ToastInput): number {
  const tone = input.tone ?? 'info';
  const item: ToastItem = {
    id: nextId++,
    title: input.title,
    tone,
    duration: input.duration ?? (tone === 'error' ? 8000 : 5000),
    ...(input.description === undefined ? {} : { description: input.description }),
  };
  items = [...items, item].slice(-MAX_VISIBLE);
  emit();
  return item.id;
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toastStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => items,
};

/** Chỉ dùng trong test. */
export function resetToastsForTest(): void {
  items = [];
  emit();
}
