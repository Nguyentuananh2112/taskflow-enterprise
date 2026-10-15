import { cn } from '@/shared/lib/cn';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

const VIEW: Readonly<Record<ConnectionState, { label: string; dot: string }>> = {
  connected: { label: 'Trực tuyến', dot: 'bg-success' },
  connecting: { label: 'Đang kết nối…', dot: 'bg-warning' },
  reconnecting: { label: 'Đang kết nối lại…', dot: 'bg-warning' },
  offline: { label: 'Mất kết nối thời gian thực', dot: 'bg-text-muted' },
};

/** Trạng thái realtime: chấm màu + chữ, không chỉ màu (frontend.md §3.5). */
export function ConnectionDot({
  state,
  className,
}: Readonly<{ state: ConnectionState; className?: string }>) {
  const view = VIEW[state];
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-1.5 text-xs text-text-muted', className)}
    >
      <span aria-hidden="true" className={cn('size-2 rounded-full', view.dot)} />
      {view.label}
    </span>
  );
}
