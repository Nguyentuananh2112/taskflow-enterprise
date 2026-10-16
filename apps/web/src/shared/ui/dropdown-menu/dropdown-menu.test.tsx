import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { DropdownMenu } from './index';

// perf/board-mount bậc 1: menu mount lười — trước tương tác là nút thật cùng ngữ nghĩa; mở bằng chuột
// hoặc Enter / Space / ArrowDown như Radix; bàn phím ⇒ focus mục đầu; Esc ⇒ focus về nút.

afterEach(cleanup);

function setup() {
  const onMove = vi.fn();
  render(
    <DropdownMenu
      label="Thao tác với TF-1"
      items={[
        { key: 'a', label: 'Chuyển tới Đang làm', onSelect: onMove },
        { key: 'b', label: 'Xuống cuối cột', onSelect: vi.fn() },
      ]}
    />,
  );
  const trigger = () => screen.getByRole('button', { name: 'Thao tác với TF-1' });
  return { onMove, trigger, user: userEvent.setup({ delay: null }) };
}

describe('DropdownMenu (mount lười)', () => {
  it('trước tương tác: nút thật, aria-haspopup=menu, aria-expanded=false, chưa có menu; a11y sạch', async () => {
    const { trigger } = setup();
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    await expectNoA11yViolations();
  });

  it.each([['{Enter}'], [' '], ['{ArrowDown}']])(
    'phím %s ⇒ mở menu và focus mục đầu; Esc ⇒ đóng, focus về nút cùng tên',
    async (key) => {
      const { trigger, user } = setup();
      trigger().focus();
      await user.keyboard(key);
      await screen.findByRole('menu');
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole('menuitem', { name: 'Chuyển tới Đang làm' }),
        ),
      );
      expect(trigger().getAttribute('aria-expanded')).toBe('true');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(document.activeElement).toBe(trigger());
    },
  );

  it('chuột ⇒ mở; chọn mục ⇒ gọi onSelect, menu đóng; mở lại lần 2 vẫn được', async () => {
    const { onMove, trigger, user } = setup();
    await user.click(trigger());
    await user.click(await screen.findByRole('menuitem', { name: 'Chuyển tới Đang làm' }));
    expect(onMove).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await user.click(trigger());
    expect(await screen.findByRole('menu')).toBeTruthy();
    await expectNoA11yViolations();
  });
});
