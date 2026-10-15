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

export const nextNavigationMock = {
  useRouter: () => testRouter,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
};
