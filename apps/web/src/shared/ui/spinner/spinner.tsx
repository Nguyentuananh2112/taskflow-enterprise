import { cn } from '@/shared/lib/cn';

type Props = Readonly<{
  /** Nhãn cho trình đọc màn hình. `null` = trang trí (khi phần tử cha đã có nhãn, vd nút đang tải). */
  label?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}>;

export function Spinner({ label = 'Đang tải', size = 'md', className }: Props) {
  const icon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('animate-spin', size === 'sm' ? 'size-4' : 'size-6', className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (label === null) return icon;
  return (
    <span role="status" className="inline-flex items-center">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
