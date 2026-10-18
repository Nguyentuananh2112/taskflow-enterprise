'use client';

import { useState } from 'react';

import { cn } from '@/shared/lib/cn';
import { isApiMediaUrl } from '@/shared/lib/media-url';

import { AVATAR_COLORS, avatarColorIndex, initialsOf } from './avatar-utils';

const SIZES = {
  sm: { box: 'size-6 text-[10px]', px: 24 },
  md: { box: 'size-8 text-xs', px: 32 },
  lg: { box: 'size-24 text-2xl', px: 96 },
} as const;

type Props = Readonly<{
  /** Họ tên đầy đủ — dùng sinh chữ cái và làm nhãn cho trình đọc màn hình. */
  name: string;
  /** Khóa ổn định để chọn màu (thường là userId); mặc định là `name`. */
  colorKey?: string;
  /**
   * URL ảnh (URL ký có hạn — avatar-chat.md ADR-141/142). Không có / `null` / tải lỗi (URL hết khung, ảnh đã
   * gỡ) ⇒ chữ cái.
   */
  src?: string | null | undefined;
  size?: keyof typeof SIZES;
  /** `true` khi tên đã hiển thị ngay cạnh avatar (tránh đọc tên 2 lần). */
  decorative?: boolean;
  /** Danh sách dài (thành viên, board): `lazy`. Header / trang tài khoản: để mặc định. */
  loading?: 'lazy' | 'eager';
  className?: string;
}>;

export function Avatar({
  name,
  colorKey,
  src,
  size = 'md',
  decorative = false,
  loading,
  className,
}: Props) {
  // Ghi nhớ URL đã lỗi thay vì cờ boolean: `src` đổi (ảnh mới / URL ký mới) ⇒ tự thử lại, không cần effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const { box, px } = SIZES[size];
  const label = decorative ? { 'aria-hidden': true as const } : { title: name };

  // B L2: chỉ URL ảnh của chính API (/media/avatars) — data:/blob:/origin lạ ⇒ chữ cái.
  if (src && failedSrc !== src && isApiMediaUrl(src, 'avatars')) {
    return (
      // Ảnh từ API khác origin, URL ký có hạn ⇒ không qua next/image (tối ưu ảnh của Next sẽ cache URL ký).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={decorative ? '' : name}
        width={px}
        height={px}
        decoding="async"
        {...(loading ? { loading } : {})}
        // R43: URL ký là bearer — không lộ qua Referer.
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
        {...label}
        className={cn('shrink-0 rounded-full bg-bg-subtle object-cover', box, className)}
      />
    );
  }

  const color = AVATAR_COLORS[avatarColorIndex(colorKey ?? name)] ?? AVATAR_COLORS[0];
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name, title: name })}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        color.className,
        box,
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
