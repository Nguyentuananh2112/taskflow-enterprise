import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { Combobox } from './combobox';

// Mẫu ARIA APG "combobox with listbox popup": role/aria-* đúng, bàn phím ↑/↓/Enter/Esc.

const OPTIONS = [
  { value: '', label: 'Chưa giao' },
  { value: 'a', label: 'Trần Lan' },
  { value: 'b', label: 'Mai Hoa' },
];

function Harness({ onSelect }: { onSelect: (v: string) => void }) {
  const [query, setQuery] = useState('');
  return (
    <Combobox
      label="Người phụ trách"
      options={OPTIONS}
      selectedLabel="Chưa giao"
      query={query}
      onQueryChange={setQuery}
      onSelect={onSelect}
    />
  );
}

afterEach(() => cleanup());

describe('Combobox', () => {
  it('đóng: hiện nhãn đã chọn, aria-expanded=false, listbox ẩn; a11y', async () => {
    render(<Harness onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: 'Người phụ trách' });
    expect(input).toHaveProperty('value', 'Chưa giao');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await expectNoA11yViolations();
  });

  it('↓ mở, ↓ chuyển option (aria-activedescendant), Enter chọn và đóng', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const user = userEvent.setup({ delay: null });
    const input = screen.getByRole('combobox');
    await user.click(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const active = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(active ?? '')?.textContent).toBe('Mai Hoa');
    expect(screen.getByRole('option', { name: 'Mai Hoa' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('mở mà không có option: chữ "trống" / "đang tìm" là status NGOÀI listbox; axe không có aria-required-children (E2E-CH-07)', async () => {
    function Empty({ loading }: { loading: boolean }) {
      return (
        <Combobox
          label="Tìm người"
          options={[]}
          selectedLabel=""
          query=""
          onQueryChange={() => undefined}
          onSelect={() => undefined}
          loading={loading}
          emptyText="Gõ tên để tìm"
        />
      );
    }
    const { rerender } = render(<Empty loading={false} />);
    await userEvent.setup({ delay: null }).click(screen.getByRole('combobox'));
    expect(screen.getByRole('status').textContent).toBe('Gõ tên để tìm');
    expect(screen.queryByRole('listbox')).toBeNull(); // rỗng ⇒ ẩn, không phải listbox không có option
    await expectNoA11yViolations();
    rerender(<Empty loading />);
    expect(screen.getByRole('status').textContent).toBe('Đang tìm…');
  });

  it('Esc đóng không chọn; ↑ từ đầu vòng về cuối', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const user = userEvent.setup({ delay: null });
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowUp}');
    expect(
      document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent,
    ).toBe('Mai Hoa');
    await user.keyboard('{Escape}');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
