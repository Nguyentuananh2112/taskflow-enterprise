import { cn } from '@/shared/lib/cn';

import { AVATAR_COLORS, avatarColorIndex, initialsOf } from './avatar-utils';

type Props = Readonly<{
  /** Họ tên đầy đủ — dùng sinh chữ cái và làm nhãn cho trình đọc màn hình. */
  name: string;
  /** Khóa ổn định để chọn màu (thường là userId); mặc định là `name`. */
  colorKey?: string;
  size?: 'sm' | 'md';
  /** `true` khi tên đã hiển thị ngay cạnh avatar (tránh đọc tên 2 lần). */
  decorative?: boolean;
  className?: string;
}>;

export function Avatar({ name, colorKey, size = 'md', decorative = false, className }: Props) {
  const color = AVATAR_COLORS[avatarColorIndex(colorKey ?? name)] ?? AVATAR_COLORS[0];
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
      title={decorative ? undefined : name}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        color.className,
        size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
