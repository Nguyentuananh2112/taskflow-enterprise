import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';

describe('Spinner', () => {
  afterEach(cleanup);

  it('mặc định là role status với nhãn "Đang tải"', async () => {
    const { container } = render(<Spinner />);
    expect(screen.getByRole('status').textContent).toBe('Đang tải');
    await expectNoA11yViolations(container);
  });

  it('label={null} ⇒ chỉ là hình trang trí', () => {
    render(<Spinner label={null} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Skeleton', () => {
  afterEach(cleanup);

  it('luôn ẩn khỏi trình đọc màn hình — vùng chứa tự báo aria-busy', async () => {
    const { container } = render(
      <div role="status" aria-busy="true" aria-label="Đang tải danh sách">
        <Skeleton className="h-4 w-32" />
      </div>,
    );
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    await expectNoA11yViolations(container);
  });
});

describe('EmptyState', () => {
  afterEach(cleanup);

  it('tiêu đề là heading, có mô tả và hành động', async () => {
    const { container } = render(
      <EmptyState
        title="Chưa có dự án"
        description="Tạo dự án đầu tiên để bắt đầu."
        action={<Button>Tạo dự án</Button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Chưa có dự án' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Tạo dự án' })).toBeDefined();
    await expectNoA11yViolations(container);
  });

  it('headingLevel 3 khi nằm trong một section đã có h2', () => {
    render(<EmptyState title="Cột trống" headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Cột trống' })).toBeDefined();
  });
});
