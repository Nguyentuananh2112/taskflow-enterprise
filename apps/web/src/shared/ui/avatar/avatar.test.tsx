import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { resetRuntimeConfigForTest, setRuntimeConfig } from '@/shared/config';

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
  beforeEach(() =>
    setRuntimeConfig({
      apiUrl: 'http://localhost:4000/api/v1',
      wsUrl: 'http://localhost:4000',
      appEnv: 'test',
    }),
  );
  afterEach(() => {
    cleanup();
    resetRuntimeConfigForTest();
  });

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

  describe('ảnh (src — avatar-chat.md ADR-142, §7 E1)', () => {
    const URL_A = 'http://localhost:4000/api/v1/media/avatars/u1/64?v=1&exp=1&sig=a';
    const URL_B = 'http://localhost:4000/api/v1/media/avatars/u1/64?v=2&exp=1&sig=b';

    it('có src ⇒ <img> alt = họ tên, kích thước cố định, không gửi Referer', async () => {
      const { container } = render(<Avatar name="Nguyễn Văn An" src={URL_A} size="sm" />);
      const img = screen.getByRole('img', { name: 'Nguyễn Văn An' });
      expect(img.tagName).toBe('IMG');
      expect(img.getAttribute('src')).toBe(URL_A);
      expect(img.getAttribute('width')).toBe('24');
      expect(img.getAttribute('height')).toBe('24');
      expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(container.querySelector('[style]')).toBeNull();
      await expectNoA11yViolations(container);
    });

    it('decorative ⇒ alt rỗng + aria-hidden', () => {
      const { container } = render(<Avatar name="Trần Lan" src={URL_A} decorative />);
      expect(screen.queryByRole('img')).toBeNull();
      const img = container.querySelector('img');
      expect(img?.getAttribute('alt')).toBe('');
      expect(img?.getAttribute('aria-hidden')).toBe('true');
    });

    it('null / undefined ⇒ chữ cái', () => {
      render(
        <>
          <Avatar name="Mai Hoa" src={null} />
          <Avatar name="Lê Bình" />
        </>,
      );
      expect(screen.getByRole('img', { name: 'Mai Hoa' }).textContent).toBe('MH');
      expect(screen.getByRole('img', { name: 'Lê Bình' }).textContent).toBe('LB');
    });

    it('ảnh lỗi (URL hết khung) ⇒ chữ cái cùng nhãn; src mới ⇒ thử lại ảnh', () => {
      const { rerender } = render(<Avatar name="Nguyễn Văn An" src={URL_A} />);
      fireEvent.error(screen.getByRole('img', { name: 'Nguyễn Văn An' }));
      const fallback = screen.getByRole('img', { name: 'Nguyễn Văn An' });
      expect(fallback.tagName).toBe('SPAN');
      expect(fallback.textContent).toBe('NA');

      rerender(<Avatar name="Nguyễn Văn An" src={URL_B} />);
      expect(screen.getByRole('img', { name: 'Nguyễn Văn An' }).getAttribute('src')).toBe(URL_B);
    });

    it('loading chỉ đặt khi truyền (header không lazy)', () => {
      const { container, rerender } = render(<Avatar name="A B" src={URL_A} />);
      expect(container.querySelector('img')?.hasAttribute('loading')).toBe(false);
      rerender(<Avatar name="A B" src={URL_A} loading="lazy" />);
      expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    });

    it('B L2: URL không thuộc /media/avatars của API (data:, blob:, origin lạ) ⇒ chữ cái, không <img>', () => {
      for (const src of [
        'data:image/png;base64,AAAA',
        'blob:http://localhost:4000/x',
        'https://evil.example/api/v1/media/avatars/u/64',
      ]) {
        const { container } = render(<Avatar name="Mai Hoa" src={src} />);
        expect(container.querySelector('img')).toBeNull();
        cleanup();
      }
    });

    it('size lg ⇒ 96 px', () => {
      render(<Avatar name="A B" src={URL_A} size="lg" />);
      expect(screen.getByRole('img').getAttribute('width')).toBe('96');
    });
  });

  it.each(AVATAR_COLORS.map((c) => c.hex))('nền %s đạt ≥ 4.5:1 với chữ trắng', (hex) => {
    expect(contrastWithWhite(hex)).toBeGreaterThanOrEqual(4.5);
  });
});
