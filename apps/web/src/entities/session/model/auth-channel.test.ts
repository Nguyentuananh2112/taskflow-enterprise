import { describe, expect, it, vi } from 'vitest';

import { AUTH_CHANNEL_NAME, openAuthChannel } from './auth-channel';

/** BroadcastChannel giả nối 2 "tab" cùng tên kênh. */
function fakeBus() {
  const members = new Set<FakeChannel>();
  class FakeChannel {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    readonly sent: unknown[] = [];
    constructor(readonly name: string) {
      members.add(this);
    }
    postMessage(data: unknown) {
      this.sent.push(data);
      for (const other of members) {
        if (other !== this && other.name === this.name) other.onmessage?.({ data } as MessageEvent);
      }
    }
    close() {
      members.delete(this);
    }
  }
  return (name: string) => new FakeChannel(name) as unknown as BroadcastChannel;
}

describe('openAuthChannel', () => {
  it('tab A logout ⇒ tab B nhận; tab gửi không tự nhận lại', () => {
    const create = fakeBus();
    const onA = vi.fn();
    const onB = vi.fn();
    const a = openAuthChannel(onA, create);
    openAuthChannel(onB, create);
    a.post({ type: 'logout' });
    expect(onB).toHaveBeenCalledWith({ type: 'logout' });
    expect(onA).not.toHaveBeenCalled();
  });

  it('dùng kênh "tf-auth" và bỏ qua message lạ (không tin dữ liệu từ kênh)', () => {
    const names: string[] = [];
    const bus = fakeBus();
    const create = (name: string) => {
      names.push(name);
      return bus(name);
    };
    const onMessage = vi.fn();
    openAuthChannel(onMessage, create);
    const other = create(AUTH_CHANNEL_NAME);
    other.postMessage({ type: 'steal', token: 'x' });
    other.postMessage('logout');
    other.postMessage(null);
    expect(names[0]).toBe(AUTH_CHANNEL_NAME);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('chỉ chuyển tiếp trường `type` — không mang theo dữ liệu thừa', () => {
    const create = fakeBus();
    const onMessage = vi.fn();
    openAuthChannel(onMessage, create);
    create(AUTH_CHANNEL_NAME).postMessage({ type: 'login', accessToken: 'leak' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'login' });
  });

  it('không có BroadcastChannel ⇒ kênh rỗng, không ném lỗi', () => {
    const channel = openAuthChannel(vi.fn(), undefined);
    expect(() => channel.post({ type: 'logout' })).not.toThrow();
  });
});
