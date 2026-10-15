import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { Drawer } from './index';

describe('Drawer', () => {
  afterEach(cleanup);

  it('mở: role dialog có tên, nút Đóng có nhãn tiếng Việt, không vi phạm a11y', async () => {
    render(
      <Drawer open onOpenChange={() => undefined} title="WEB-112">
        <p>Nội dung task</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'WEB-112' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeDefined();
    await expectNoA11yViolations(document.body);
  });

  it('nút Đóng và Escape gọi onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onOpenChange} title="WEB-112">
        <p>Nội dung</p>
      </Drawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange.mock.calls).toEqual([[false], [false]]);
  });

  it('đóng ⇒ không render gì', () => {
    render(
      <Drawer open={false} onOpenChange={() => undefined} title="WEB-112">
        <p>Nội dung</p>
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
