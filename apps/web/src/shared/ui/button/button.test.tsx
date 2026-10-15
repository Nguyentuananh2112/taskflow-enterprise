import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { Button } from './index';

describe('Button', () => {
  afterEach(cleanup);

  it('mọi biến thể render được và không vi phạm a11y', async () => {
    const { container } = render(
      <div>
        <Button>Lưu</Button>
        <Button variant="secondary">Hủy</Button>
        <Button variant="ghost" size="sm">
          Thêm
        </Button>
        <Button variant="danger">Xóa</Button>
      </div>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(4);
    await expectNoA11yViolations(container);
  });

  it('mặc định type="button" (không vô tình submit form)', () => {
    render(<Button>Lưu</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('loading ⇒ disabled + aria-busy, không gọi onClick, nhãn vẫn đọc được', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        Đang lưu
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Đang lưu' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    await expectNoA11yViolations(container);
  });

  it('asChild render phần tử con (link) với style của Button', () => {
    render(
      <Button asChild>
        <a href="/login">Đăng nhập</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Đăng nhập' });
    expect(link.className).toContain('bg-primary');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
