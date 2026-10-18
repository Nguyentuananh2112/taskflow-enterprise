// Router giả cho `next/navigation` trong test tích hợp: điều hướng = history API của jsdom.
// Dùng: vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock)

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const testRouter = {
  push: (url: string) => {
    window.history.pushState({}, '', url);
    notify();
  },
  replace: (url: string) => {
    window.history.replaceState({}, '', url);
    notify();
  },
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  prefetch: () => undefined,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  pathname: () => window.location.pathname,
};

/** Tham số động của route app/ (`/w/[wsId]`, `/w/[wsId]/p/[projectId]`, Mốc 6: `/chat/[id]`, `/chat/ws/[wsId]`). */
function paramsOf(pathname: string): Record<string, string> {
  const room = /^\/chat\/ws\/([^/]+)/.exec(pathname);
  if (room) return { wsId: room[1] ?? '' };
  const chat = /^\/chat\/([^/]+)/.exec(pathname);
  if (chat) return { id: chat[1] ?? '' };
  const match = /^\/w\/([^/]+)(?:\/p\/([^/]+))?/.exec(pathname);
  if (!match) return {};
  return { wsId: match[1] ?? '', ...(match[2] ? { projectId: match[2] } : {}) };
}

export const nextNavigationMock = {
  useRouter: () => testRouter,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useParams: () => paramsOf(window.location.pathname),
};
