import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { Select } from './index';

const ROLES = [
  { value: 'MEMBER', label: 'Thành viên' },
  { value: 'VIEWER', label: 'Người xem' },
  { value: 'PM', label: 'Quản lý dự án', disabled: true },
];

describe('Select', () => {
  afterEach(cleanup);

  it('liệt kê option, placeholder không chọn được, không vi phạm a11y', async () => {
    const { container } = render(
      <Select label="Vai trò" options={ROLES} placeholder="Chọn vai trò…" defaultValue="" />,
    );
    const select = screen.getByRole('combobox', { name: 'Vai trò' });
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Chọn vai trò…',
      'Thành viên',
      'Người xem',
      'Quản lý dự án',
    ]);
    expect(options[0]).toHaveProperty('disabled', true);
    expect(options[3]).toHaveProperty('disabled', true);
    expect(select).toHaveProperty('value', '');
    await expectNoA11yViolations(container);
  });

  it('onChange nhận giá trị đã chọn', () => {
    const onChange = vi.fn();
    render(<Select label="Vai trò" options={ROLES} defaultValue="MEMBER" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Vai trò'), { target: { value: 'VIEWER' } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Vai trò')).toHaveProperty('value', 'VIEWER');
  });

  it('lỗi ⇒ aria-invalid + mô tả lỗi', async () => {
    const { container } = render(
      <Select label="Vai trò" options={ROLES} error="Chọn một vai trò" />,
    );
    const select = screen.getByLabelText('Vai trò');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(select.getAttribute('aria-describedby')).toBe(screen.getByText('Chọn một vai trò').id);
    await expectNoA11yViolations(container);
  });

  it('hideLabel: nhãn chỉ cho trình đọc màn hình nhưng vẫn là tên truy cập', async () => {
    const { container } = render(
      <Select
        label="Vai trò của An"
        hideLabel
        options={[{ value: 'MEMBER', label: 'Thành viên' }]}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Vai trò của An' })).toBeTruthy();
    expect(screen.getByText('Vai trò của An').className).toContain('sr-only');
    await expectNoA11yViolations(container);
  });
});
