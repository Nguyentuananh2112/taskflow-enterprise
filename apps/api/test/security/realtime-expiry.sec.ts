import { afterEach, describe, expect } from 'vitest';

import { useCompanyApi } from './harness/company';
import { connected, connectError, disconnected, nextEvent, openSocket } from './harness/socket';
import { secCase } from './harness/suite';

// SEC-38 cần access token hết hạn TRONG lúc chạy ⇒ API riêng với TTL ngắn nhất cho phép (5 s, chỉ khi
// APP_ENV=test — env.ts). File riêng vì `useApi` làm mới DB suite + giữ khóa suốt file: hai `useApi`
// trong cùng file sẽ xóa DB của nhau.
const { api, actors } = useCompanyApi({ JWT_ACCESS_TTL_SECONDS: '5' });
const opened: ReturnType<typeof openSocket>[] = [];
afterEach(() => {
  for (const socket of opened.splice(0)) socket.close();
});

describe('Hết hạn access token trên socket', () => {
  secCase(
    'SEC-38',
    'Không auth:renew quá exp ⇒ auth:expired rồi bị ngắt',
    'socket auth',
    async () => {
      const mia = await actors.register('mia');
      const socket = openSocket(api, mia.accessToken);
      opened.push(socket);
      await connected(socket);
      const expired = nextEvent(socket, 'auth:expired', 10_000);
      const gone = disconnected(socket, 12_000);
      await expired;
      expect(await gone).toBe('io server disconnect');

      // MW-10: token đã hết hạn ở handshake ⇒ TOKEN_EXPIRED (khác token sai ⇒ UNAUTHORIZED). Bộ kiểm
      // JWT có clockTolerance 5 s ⇒ chờ quá dung sai. Trong 5 s đó handshake vẫn nhận nhưng socket mới
      // có hạn còn lại 0 ⇒ bị auth:expired + ngắt ngay (không lợi gì) — không phải lỗ hổng.
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      const again = openSocket(api, mia.accessToken);
      opened.push(again);
      expect(await connectError(again)).toEqual({
        message: 'TOKEN_EXPIRED',
        code: 'TOKEN_EXPIRED',
      });
    },
    30_000,
  );
});
