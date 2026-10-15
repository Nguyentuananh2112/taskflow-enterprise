import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { Toaster, resetToastsForTest, toast } from './index';

describe('toast + Toaster', () => {
  afterEach(() => {
    cleanup();
    act(() => resetToastsForTest());
  });

  it('toast() hiển thị tiêu đề + mô tả, vùng thông báo có nhãn tiếng Việt', async () => {
    const { container } = render(<Toaster />);
    act(() => {
      toast({ title: 'Đã lưu', description: 'Task WEB-112 đã được cập nhật.', tone: 'success' });
    });
    expect(screen.getByText('Đã lưu')).toBeDefined();
    expect(screen.getByText('Task WEB-112 đã được cập nhật.')).toBeDefined();
    expect(screen.getByRole('region', { name: /Thông báo/ })).toBeDefined();
    await expectNoA11yViolations(container);
  });

  it('nút đóng xóa thông báo', () => {
    render(<Toaster />);
    act(() => {
      toast({ title: 'Không lưu được', tone: 'error' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(screen.queryByText('Không lưu được')).toBeNull();
  });

  it('chỉ giữ tối đa 3 thông báo gần nhất', () => {
    render(<Toaster />);
    act(() => {
      for (const n of [1, 2, 3, 4]) toast({ title: `Thông báo ${n}` });
    });
    expect(screen.queryByText('Thông báo 1')).toBeNull();
    expect(screen.getByText('Thông báo 4')).toBeDefined();
  });
});
