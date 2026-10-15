// Đồng bộ đa tab (frontend.md §3.3): `logout` ⇒ tab khác kết thúc phiên ngay; `login` ⇒ tab đang ở
// màn khách khôi phục phiên. Chỉ gửi loại sự kiện — KHÔNG BAO GIỜ gửi token qua kênh này.

export type AuthMessage = Readonly<{ type: 'login' | 'logout' }>;

export type AuthChannel = Readonly<{ post: (message: AuthMessage) => void; close: () => void }>;

export const AUTH_CHANNEL_NAME = 'tf-auth';

const isAuthMessage = (data: unknown): data is AuthMessage =>
  typeof data === 'object' &&
  data !== null &&
  'type' in data &&
  (data.type === 'login' || data.type === 'logout');

/** Không có BroadcastChannel (SSR, trình duyệt rất cũ) ⇒ kênh rỗng. */
export function openAuthChannel(
  onMessage: (message: AuthMessage) => void,
  create: ((name: string) => BroadcastChannel) | undefined = typeof BroadcastChannel === 'undefined'
    ? undefined
    : (name) => new BroadcastChannel(name),
): AuthChannel {
  if (!create) return { post: () => undefined, close: () => undefined };
  const channel = create(AUTH_CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (isAuthMessage(event.data)) onMessage({ type: event.data.type });
  };
  return { post: (message) => channel.postMessage(message), close: () => channel.close() };
}
