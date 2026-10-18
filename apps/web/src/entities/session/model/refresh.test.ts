import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/api';

import {
  REFRESH_LOCK,
  REFRESH_MAX_RETRIES,
  REFRESH_RETRY_DELAY_MS,
  REFRESH_RETRY_JITTER_MS,
  createRefresher,
  type LockRequester,
} from './refresh';

const TOKEN = { accessToken: 'at-1', expiresIn: 900 };
const apiError = (status: number, code: ConstructorParameters<typeof ApiError>[0]['code']) =>
  new ApiError({ status, code, message: code });

/** Web Locks giả: tuần tự hóa callback theo tên khóa như trình duyệt. */
function fakeLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  const names: string[] = [];
  const locks: LockRequester = {
    request: ((name: string, callback: () => Promise<unknown>) => {
      names.push(name);
      const run = tail.then(callback);
      tail = run.catch(() => undefined);
      return run;
    }) as LockRequester['request'],
  };
  return { locks, names };
}

describe('createRefresher', () => {
  it('5 lời gọi đồng thời trong tab ⇒ đúng 1 request refresh (single-flight)', async () => {
    let release!: () => void;
    const call = vi.fn(
      () => new Promise<typeof TOKEN>((resolve) => (release = () => resolve(TOKEN))),
    );
    const refresher = createRefresher({ call });
    const pending = Array.from({ length: 5 }, () => refresher.run());
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    release();
    await expect(Promise.all(pending)).resolves.toEqual(Array(5).fill(TOKEN));
    expect(call).toHaveBeenCalledOnce();
  });

  it('xuyên tab: chạy trong Web Lock "tf-refresh"', async () => {
    const { locks, names } = fakeLocks();
    const refresher = createRefresher({ call: () => Promise.resolve(TOKEN), locks });
    await expect(refresher.run()).resolves.toEqual(TOKEN);
    expect(names).toEqual([REFRESH_LOCK]);
  });

  it('409 REFRESH_IN_PROGRESS ⇒ đợi 300–800 ms (jitter) rồi thử lại; 2 lần 409 rồi thành công ⇒ token', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const call = vi
      .fn<() => Promise<typeof TOKEN>>()
      .mockRejectedValueOnce(apiError(409, 'REFRESH_IN_PROGRESS'))
      .mockRejectedValueOnce(apiError(409, 'REFRESH_IN_PROGRESS'))
      .mockResolvedValueOnce(TOKEN);
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.999);
    await expect(createRefresher({ call, sleep, random }).run()).resolves.toEqual(TOKEN);
    expect(sleep.mock.calls).toEqual([
      [REFRESH_RETRY_DELAY_MS],
      [REFRESH_RETRY_DELAY_MS + REFRESH_RETRY_JITTER_MS - 1],
    ]);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it(`409 mãi ⇒ thử lại tối đa ${String(REFRESH_MAX_RETRIES)} lần rồi ném lỗi (tạm thời), không coi là mất phiên`, async () => {
    const call = vi.fn(() => Promise.reject(apiError(409, 'REFRESH_IN_PROGRESS')));
    const refresher = createRefresher({ call, sleep: () => Promise.resolve() });
    await expect(refresher.run()).rejects.toMatchObject({ code: 'REFRESH_IN_PROGRESS' });
    expect(call).toHaveBeenCalledTimes(REFRESH_MAX_RETRIES + 1);
  });

  it.each(['REFRESH_TOKEN_INVALID', 'ORIGIN_NOT_ALLOWED'] as const)(
    '%s ⇒ null (phiên không còn — đăng nhập lại)',
    async (code) => {
      const call = () => Promise.reject(apiError(code === 'ORIGIN_NOT_ALLOWED' ? 403 : 401, code));
      await expect(createRefresher({ call }).run()).resolves.toBeNull();
    },
  );

  it('lỗi mạng ⇒ ném lỗi (không coi là mất phiên)', async () => {
    const call = () => Promise.reject(apiError(0, 'NETWORK_ERROR'));
    await expect(createRefresher({ call }).run()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('xong một lượt thì lượt sau gọi refresh mới (không giữ kết quả cũ)', async () => {
    const call = vi.fn(() => Promise.resolve(TOKEN));
    const refresher = createRefresher({ call });
    await refresher.run();
    await refresher.run();
    expect(call).toHaveBeenCalledTimes(2);
  });
});
