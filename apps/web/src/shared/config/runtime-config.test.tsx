import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  RuntimeConfigBoot,
  getRuntimeConfig,
  resetRuntimeConfigForTest,
  setRuntimeConfig,
} from '@/shared/config';

const CONFIG = {
  apiUrl: 'http://localhost:4000/api/v1',
  wsUrl: 'http://localhost:4000',
  appEnv: 'local',
} as const;

describe('runtime config', () => {
  afterEach(() => {
    cleanup();
    resetRuntimeConfigForTest();
  });

  it('getRuntimeConfig() trước khi boot ⇒ throw (không im lặng dùng mặc định)', () => {
    expect(() => getRuntimeConfig()).toThrow(/RuntimeConfigBoot/);
  });

  it('setRuntimeConfig từ chối khóa lạ (không cho secret lọt vào store)', () => {
    expect(() => setRuntimeConfig({ ...CONFIG, secret: 'x' } as never)).toThrow();
  });

  it('RuntimeConfigBoot ghi cấu hình TRƯỚC khi con render', () => {
    function Child() {
      return <span>{getRuntimeConfig().apiUrl}</span>;
    }
    render(
      <RuntimeConfigBoot config={CONFIG}>
        <Child />
      </RuntimeConfigBoot>,
    );
    expect(screen.getByText(CONFIG.apiUrl)).toBeDefined();
  });
});
