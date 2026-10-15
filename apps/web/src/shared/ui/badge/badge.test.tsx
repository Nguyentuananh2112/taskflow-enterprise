import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { Badge, type BadgeTone } from './index';

const TONES: BadgeTone[] = ['neutral', 'primary', 'success', 'warning', 'danger'];

describe('Badge', () => {
  afterEach(cleanup);

  it('mọi tone render được, icon là trang trí', async () => {
    const { container } = render(
      <div>
        {TONES.map((tone) => (
          <Badge key={tone} tone={tone} icon="▲">
            {tone}
          </Badge>
        ))}
      </div>,
    );
    for (const tone of TONES) expect(screen.getByText(tone)).toBeDefined();
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(TONES.length);
    await expectNoA11yViolations(container);
  });
});
