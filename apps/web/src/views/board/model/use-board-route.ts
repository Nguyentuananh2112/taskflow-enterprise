import { Uuid } from '@taskflow/contracts/common';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useRef } from 'react';

/**
 * Tham số board từ URL (frontend.md §1.1): `/w/[wsId]/p/[projectId]?task=[taskId]` — uuid, không
 * slug. Mở drawer = `push` (nút Back đóng drawer); đóng = `replace`. Ghi nhớ thẻ đã mở để trả focus.
 */
export function useBoardRoute() {
  const params = useParams<{ wsId: string; projectId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const wsId = params.wsId ?? '';
  const projectId = params.projectId ?? '';
  const valid = Uuid.safeParse(wsId).success && Uuid.safeParse(projectId).success;
  const rawTask = search.get('task');
  const taskId = rawTask && Uuid.safeParse(rawTask).success ? rawTask : null;
  const scope = useMemo(() => ({ wsId, projectId }), [wsId, projectId]);
  const lastOpened = useRef<string | null>(null);

  const openTask = useCallback(
    (id: string) => {
      lastOpened.current = id;
      router.push(`${pathname}?task=${encodeURIComponent(id)}`);
    },
    [router, pathname],
  );
  const closeTask = useCallback(() => router.replace(pathname), [router, pathname]);
  /** Focus quay về tiêu đề thẻ vừa mở (Radix không có Trigger vì drawer mở theo URL). */
  const returnFocus = useCallback((event: Event) => {
    const id = lastOpened.current;
    const target = id ? document.getElementById(`task-${id}-title`) : null;
    if (!target) return;
    event.preventDefault();
    target.focus();
  }, []);

  return { valid, scope, taskId, openTask, closeTask, returnFocus };
}
