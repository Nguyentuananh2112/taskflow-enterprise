import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PAGE_CONTAINER, PageMain } from './page-main';

describe('PageMain', () => {
  it('đặt <main> trong khung chung; giới hạn bề ngang chỉ áp lên khối nội dung (căn trái)', () => {
    render(
      <PageMain className="max-w-3xl gap-6">
        <h1>Tiêu đề</h1>
      </PageMain>,
    );
    const main = screen.getByRole('main');
    expect(main.className).toContain(PAGE_CONTAINER);
    expect(main.className).not.toContain('max-w-3xl');
    const content = screen.getByRole('heading').parentElement;
    expect(content?.className).toContain('max-w-3xl');
    expect(content?.className).not.toContain('mx-auto');
  });
});
