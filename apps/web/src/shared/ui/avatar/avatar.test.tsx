import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { AVATAR_COLORS, avatarColorIndex, initialsOf } from './avatar-utils';
import { Avatar } from './index';

/** Độ tương phản WCAG giữa màu hex và trắng. */
function contrastWithWhite(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return 1.05 / (luminance + 0.05);
}

describe('initialsOf', () => {
  it.each([
    ['Nguyễn Văn An', 'NA'],
    ['  trần   lan ', 'TL'],
    ['Đặng Thị Ánh', 'ĐÁ'],
    ['Khang', 'K'],
    ['', '?'],
  ])('%j → %s', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});

describe('Avatar', () => {
  afterEach(cleanup);

  it('mặc định là ảnh có tên truy cập = họ tên', async () => {
    const { container } = render(<Avatar name="Nguyễn Văn An" />);
    expect(screen.getByRole('img', { name: 'Nguyễn Văn An' }).textContent).toBe('NA');
    await expectNoA11yViolations(container);
  });

  it('decorative ⇒ ẩn khỏi trình đọc màn hình', () => {
    render(<Avatar name="Trần Lan" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('không dùng thuộc tính style (bị CSP style-src chặn khi server render)', () => {
    const { container } = render(<Avatar name="Mai Hoa" />);
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('màu ổn định theo colorKey', () => {
    expect(avatarColorIndex('user-1')).toBe(avatarColorIndex('user-1'));
  });

  it.each(AVATAR_COLORS.map((c) => c.hex))('nền %s đạt ≥ 4.5:1 với chữ trắng', (hex) => {
    expect(contrastWithWhite(hex)).toBeGreaterThanOrEqual(4.5);
  });
});
