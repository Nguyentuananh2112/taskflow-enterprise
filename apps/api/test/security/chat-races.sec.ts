import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { useChatApi } from './harness/chat';
import {
  CHAT,
  ChatClient,
  dataOf,
  ruleOf,
  type ConversationDto,
  type MessageDto,
} from './harness/chat-api';
import { secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// Mốc 6 — đua hội thoại (test-spec-chat §4, mẫu red[] ×N — `SEC_HR_RACE_RUNS`): CC-CH-01 (clientMsgId trùng), 02 (2
// DIRECT đồng thời ⇒ một), 01b (cùng clientMsgId khác thân ⇒ 422 IDEMPOTENCY_KEY_REUSED). Vế socket (đúng 1
// `chat:message:new`) ở chat-realtime.sec.ts (T-070).

const { actors } = useChatApi();
const chat = new ChatClient(actors);
const AREA = 'Mốc 6 trò chuyện — đua (T-069)';
const RUNS = Number(process.env.SEC_HR_RACE_RUNS ?? 20);

describe('đua', () => {
  secCase(
    'CC-CH-02',
    `Mia và Vic cùng POST chat/direct cho nhau ⇒ cùng một id (unique cặp); không 5xx (×${String(RUNS)})`,
    AREA,
    async () => {
      const red: string[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        const [mia, vic] = await Promise.all([
          actors.createUser(`cc2-mia-${String(i)}`),
          actors.createUser(`cc2-vic-${String(i)}`),
        ]);
        const [a, b, c] = await Promise.all([
          chat.call(mia, 'POST', CHAT.direct, { userId: vic.userId }),
          chat.call(vic, 'POST', CHAT.direct, { userId: mia.userId }),
          chat.call(mia, 'POST', CHAT.direct, { userId: vic.userId }),
        ]);
        const statuses = [a, b, c].map((r) => r.status);
        if (statuses.some((s) => s !== 200 && s !== 201)) {
          red.push(`vòng ${String(i)}: ${statuses.join(',')}`);
          continue;
        }
        const ids = new Set([a, b, c].map((r) => dataOf<ConversationDto>(r).id));
        if (ids.size !== 1) red.push(`vòng ${String(i)}: ${String(ids.size)} DIRECT khác nhau`);
        if (statuses.filter((s) => s === 201).length > 1)
          red.push(`vòng ${String(i)}: nhiều hơn một 201 (${statuses.join(',')})`);
      }
      expect(red).toEqual([]);
    },
    180_000,
  );

  secCase(
    'CC-CH-01',
    `5 POST cùng clientMsgId + cùng thân song song ⇒ [201, 200×4], cùng id, danh sách tin có đúng 1 (×${String(RUNS)})`,
    AREA,
    async () => {
      const mia = await actors.createUser('cc1-mia');
      const vic = await actors.createUser('cc1-vic');
      const d = await chat.direct(mia, vic.userId);
      const red: string[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        // Hạn mức gửi 30 tin / phút / người (SEC-CH-14) tính CẢ request lặp cùng clientMsgId ⇒ xóa bộ đếm mỗi vòng.
        await flushRateLimitCounters();
        const clientMsgId = randomUUID();
        const body = `tin ${String(i)} ${clientMsgId.slice(0, 4)}`;
        const res = await Promise.all(
          Array.from({ length: 5 }, () =>
            chat.call(mia, 'POST', CHAT.messages(d.id), { clientMsgId, body }),
          ),
        );
        const statuses = res.map((r) => r.status).sort();
        if (statuses.join(',') !== '200,200,200,200,201') {
          red.push(`vòng ${String(i)}: ${statuses.join(',')}`);
          continue;
        }
        const ids = new Set(res.map((r) => dataOf<MessageDto>(r).id));
        if (ids.size !== 1) red.push(`vòng ${String(i)}: ${String(ids.size)} id`);
      }
      const all = await chat.messages(mia, d.id);
      const perClient = new Map<string, number>();
      for (const m of all) perClient.set(m.clientMsgId, (perClient.get(m.clientMsgId) ?? 0) + 1);
      const dup = [...perClient.entries()].filter(([, n]) => n > 1);
      expect(red).toEqual([]);
      expect(dup, 'clientMsgId có hơn 1 tin').toEqual([]);
      expect(all).toHaveLength(RUNS);
    },
    180_000,
  );

  secCase(
    'CC-CH-01b',
    'cùng clientMsgId nhưng KHÁC thân (hoặc khác đính kèm) ⇒ 422 IDEMPOTENCY_KEY_REUSED, tin đầu không đổi; cùng clientMsgId ở hội thoại KHÁC ⇒ không trộn',
    AREA,
    async () => {
      const mia = await actors.createUser('cc1b-mia');
      const vic = await actors.createUser('cc1b-vic');
      const otto = await actors.createUser('cc1b-otto');
      const d = await chat.direct(mia, vic.userId);
      const clientMsgId = randomUUID();
      const first = await chat.call(mia, 'POST', CHAT.messages(d.id), {
        clientMsgId,
        body: 'bản gốc',
      });
      expect(first.status).toBe(201);
      const changed = await chat.call(mia, 'POST', CHAT.messages(d.id), {
        clientMsgId,
        body: 'bản khác',
      });
      expect(changed.status, changed.text.slice(0, 200)).toBe(422);
      expect(ruleOf(changed)).toBe('IDEMPOTENCY_KEY_REUSED');
      expect((await chat.messages(mia, d.id)).map((m) => m.body)).toEqual(['bản gốc']);

      const d2 = await chat.direct(mia, otto.userId);
      const other = await chat.call(mia, 'POST', CHAT.messages(d2.id), {
        clientMsgId,
        body: 'bản gốc',
      });
      // Khóa idempotent theo (người gửi, clientMsgId): API chọn 201 tin mới ở hội thoại kia HOẶC 422 — không bao giờ
      // trả tin của hội thoại d (lộ chéo).
      if (other.status === 200 || other.status === 201) {
        expect(dataOf<MessageDto>(other).conversationId).toBe(d2.id);
      } else {
        expect(other.status).toBe(422);
      }
    },
  );
});
