import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { Button } from '@/shared/ui/button';

import { Dialog, DialogClose } from './index';

function Example() {
  return (
    <Dialog
      title="Xóa task?"
      description="Không thể hoàn tác."
      trigger={<Button>Xóa</Button>}
      footer={
        <DialogClose>
          <Button variant="secondary">Hủy</Button>
        </DialogClose>
      }
    >
      <p>WEB-112 sẽ bị xóa.</p>
    </Dialog>
  );
}

describe('Dialog', () => {
  afterEach(cleanup);

  it('mở bằng trigger: role dialog, tên = title, mô tả = description', async () => {
    render(<Example />);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    const dialog = screen.getByRole('dialog', { name: 'Xóa task?' });
    expect(dialog.getAttribute('aria-describedby')).toBe(
      screen.getByText('Không thể hoàn tác.').id,
    );
    await expectNoA11yViolations(document.body);
  });

  it('nút Hủy (DialogClose) và phím Escape đều đóng dialog', () => {
    render(<Example />);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('chế độ điều khiển (open) không cần trigger', () => {
    render(<Dialog open title="Thông báo" />);
    expect(screen.getByRole('dialog', { name: 'Thông báo' })).toBeDefined();
  });
});
