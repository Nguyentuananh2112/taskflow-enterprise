import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HomePage } from '@/views/home';

describe('HomePage', () => {
  afterEach(cleanup);

  it('hiển thị tiêu đề ứng dụng', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'TaskFlow' })).toBeDefined();
  });
});
