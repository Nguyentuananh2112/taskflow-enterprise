import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect } from 'vitest';

import { useChatApi } from './harness/chat';
import {
  CHAT,
  ChatClient,
  dataOf,
  expectStatus,
  ruleOf,
  sameNotFound,
  type ConversationDto,
  type MessageDto,
} from './harness/chat-api';
import type { CompanyActor } from './harness/company';
import * as fx from './harness/files/fixtures';
import { secCase } from './harness/suite';
import { upload } from './harness/upload';

// Mốc 6 — IDOR / quyền hội thoại (test-spec-chat §3, ADR-143/146; route T-069 của G, contract 265d08c4): SEC-CH-01,
// 02, 03, 13s (vế S: thân lưu nguyên văn), 38 (DIRECT tới người không hoạt động). Bối cảnh §0.2; 404 "không phải người
// tham gia" phải giống hệt id ngẫu nhiên (không lộ tồn tại).

const { api, actors } = useChatApi();
const chat = new ChatClient(actors);
const AREA = 'Mốc 6 trò chuyện — IDOR (T-069)';

let hana: CompanyActor; // EMPLOYEE + HR_MANAGE
let mia: CompanyActor;
let vic: CompanyActor;
let otto: CompanyActor;
let direct: ConversationDto; // Mia ↔ Vic
let g1: ConversationDto; // Mia OWNER, Vic
let firstMessage: MessageDto;

beforeAll(async () => {
  hana = await actors.createUser('ci-hana', { grants: ['HR_MANAGE'] });
  mia = await actors.createUser('ci-mia');
  vic = await actors.createUser('ci-vic');
  otto = await actors.createUser('ci-otto');
  direct = await chat.direct(mia, vic.userId);
  firstMessage = await chat.send(mia, direct.id, 'Chào Vic');
  g1 = await chat.group(mia, `G1-${randomUUID().slice(0, 6)}`, [vic.userId, otto.userId]);
  // Otto bị bớt khỏi G1 ⇒ từ giờ là người ngoài.
  expectStatus(await chat.call(mia, 'DELETE', CHAT.member(g1.id, otto.userId)), 200, 'bớt Otto');
}, 120_000);

describe('IDOR hội thoại', () => {
  secCase(
    'SEC-CH-01',
    'Otto (người ngoài) đọc / gửi / đánh dấu đọc / sửa / xóa ở DIRECT Mia↔Vic ⇒ 404 giống hệt id ngẫu nhiên; dữ liệu và unread không đổi',
    AREA,
    async () => {
      const fakeConv = randomUUID();
      const fakeMsg = randomUUID();
      const pairs: [string, string, string, string, unknown][] = [
        ['GET messages', 'GET', CHAT.messages(direct.id), CHAT.messages(fakeConv), undefined],
        [
          'GET hội thoại',
          'GET',
          CHAT.conversation(direct.id),
          CHAT.conversation(fakeConv),
          undefined,
        ],
        [
          'POST tin',
          'POST',
          CHAT.messages(direct.id),
          CHAT.messages(fakeConv),
          { clientMsgId: randomUUID(), body: 'xâm nhập' },
        ],
        [
          'PUT read',
          'PUT',
          CHAT.read(direct.id),
          CHAT.read(fakeConv),
          { messageId: firstMessage.id },
        ],
        ['PUT mute', 'PUT', CHAT.mute(direct.id), CHAT.mute(fakeConv), { muted: true }],
        [
          'PATCH tin',
          'PATCH',
          CHAT.message(firstMessage.id),
          CHAT.message(fakeMsg),
          { body: 'sửa trộm' },
        ],
        ['DELETE tin', 'DELETE', CHAT.message(firstMessage.id), CHAT.message(fakeMsg), undefined],
      ];
      const vicUnreadBefore = (await vicView()).unread;
      for (const [what, method, real, fake, body] of pairs) {
        sameNotFound(
          await chat.call(otto, method, real, body),
          await chat.call(otto, method, fake, body),
          `Otto ${what}`,
        );
      }
      const msgs = await chat.messages(mia, direct.id);
      expect(msgs.map((m) => m.body)).toEqual(['Chào Vic']);
      expect(msgs[0]).toMatchObject({ editedAt: null, deletedAt: null });
      expect((await vicView()).unread).toBe(vicUnreadBefore);
      expect(await chat.conversationIds(otto)).not.toContain(direct.id);
    },
  );

  secCase(
    'SEC-CH-03',
    'Admin (Ada) và HR (Hana) KHÔNG có quyền đặc biệt với chat: mọi route của DIRECT / G1 / phòng ws không là thành viên ⇒ 404; danh sách không chứa',
    AREA,
    async () => {
      const ws = await actors.newWorkspace(mia, `CI-W2-${randomUUID().slice(0, 6)}`);
      const room = await chat.wsRoom(mia, ws.id);
      for (const who of [actors.ada, hana]) {
        for (const conv of [direct, g1, room]) {
          for (const [method, path, body] of [
            ['GET', CHAT.conversation(conv.id), undefined],
            ['GET', CHAT.messages(conv.id), undefined],
            ['POST', CHAT.messages(conv.id), { clientMsgId: randomUUID(), body: 'x' }],
            ['PATCH', CHAT.conversation(conv.id), { title: 'đổi' }],
            ['POST', CHAT.leave(conv.id), {}],
          ] as const) {
            const res = await chat.call(who, method, path, body);
            expectStatus(res, 404, `${who === hana ? 'Hana' : 'Ada'} ${method} ${path}`);
          }
        }
        expectStatus(
          await chat.call(who, 'PUT', CHAT.wsRoom(ws.id), {}),
          404,
          'phòng ws không là thành viên',
        );
        const ids = await chat.conversationIds(who);
        for (const conv of [direct, g1, room]) expect(ids).not.toContain(conv.id);
      }
    },
  );

  secCase(
    'SEC-CH-02',
    'Otto gắn uploadId của Mia vào tin của mình ⇒ 404 giống upload không tồn tại; Otto (đã bị bớt khỏi G1) xin download-url tệp ở G1 ⇒ 404',
    AREA,
    async () => {
      const up = await upload(api, mia.accessToken, fx.pdf(4096), { as: 'file', name: 'mia.pdf' });
      expectStatus(up as never, 201, 'Mia upload');
      const miaUpload = dataOf<{ uploadId: string }>(up as never).uploadId;
      const ottoDirect = await chat.direct(otto, vic.userId);
      sameNotFound(
        await chat.sendRaw(otto, ottoDirect.id, { attachmentIds: [miaUpload] }),
        await chat.sendRaw(otto, ottoDirect.id, { attachmentIds: [randomUUID()] }),
        'Otto gắn upload của Mia',
      );

      const own = await upload(api, mia.accessToken, fx.pdf(2048), { as: 'file', name: 'g1.pdf' });
      const ownId = dataOf<{ uploadId: string }>(own as never).uploadId;
      const sent = await chat.sendRaw(mia, g1.id, { attachmentIds: [ownId] });
      expectStatus(sent, 201, 'Mia gửi tệp vào G1');
      const attachmentId = dataOf<MessageDto>(sent).attachments[0]?.id ?? '';
      expectStatus(
        await chat.call(vic, 'POST', CHAT.downloadUrl(attachmentId), {}),
        200,
        'Vic (thành viên) xin URL',
      );
      sameNotFound(
        await chat.call(otto, 'POST', CHAT.downloadUrl(attachmentId), {}),
        await chat.call(otto, 'POST', CHAT.downloadUrl(randomUUID()), {}),
        'Otto xin download-url ở G1',
      );
    },
  );
});

describe('thân tin, người nhận', () => {
  secCase(
    'SEC-CH-13s',
    'thân tin chứa HTML / script / link javascript: được LƯU và TRẢ nguyên văn (server không lọc, không biến đổi — web hiển thị bằng text); NFC + trim; ký tự điều khiển ⇒ 400',
    AREA,
    async () => {
      const payload =
        '<img src=x onerror=alert(1)> <script>alert(2)</script> javascript:alert(3) "\'&';
      const sent = await chat.send(mia, direct.id, payload);
      expect(sent.body).toBe(payload);
      const back = (await chat.messages(vic, direct.id)).find((m) => m.id === sent.id);
      expect(back?.body).toBe(payload);
      const nfd = `  Tie${String.fromCharCode(0x0302)}${String.fromCharCode(0x0301)}ng Vie${String.fromCharCode(0x0323)}t  `;
      const normalized = await chat.send(mia, direct.id, nfd);
      expect(normalized.body).toBe(nfd.normalize('NFC').trim());
      const bad = await chat.sendRaw(mia, direct.id, { body: `a${String.fromCharCode(7)}b` });
      expectStatus(bad, 400, 'ký tự điều khiển');
    },
  );

  secCase(
    'SEC-CH-38',
    'DIRECT tới chính mình ⇒ 422 SELF_DIRECT; tới người chờ kích hoạt (Nina) / đã nghỉ (Quinn) ⇒ 422 RECIPIENT_INACTIVE; tới UUID lạ ⇒ 404 user; DIRECT cũ với người nay đã nghỉ: canSend false, gửi ⇒ 422',
    AREA,
    async () => {
      const self = await chat.call(mia, 'POST', CHAT.direct, { userId: mia.userId });
      expectStatus(self, 422, 'DIRECT chính mình');
      expect(ruleOf(self)).toBe('SELF_DIRECT');

      const nina = await actors.createUser('ci-nina', { pending: true });
      const toNina = await chat.call(mia, 'POST', CHAT.direct, { userId: nina.userId });
      expectStatus(toNina, 422, 'DIRECT tới Nina (chờ kích hoạt)');
      expect(ruleOf(toNina)).toBe('RECIPIENT_INACTIVE');

      const quinn = await actors.createUser('ci-quinn', { startDate: shiftDays(-5) });
      const old = await chat.direct(mia, quinn.userId);
      await chat.send(mia, old.id, 'Trước khi nghỉ');
      await actors.offboard(hana, quinn.userId, shiftDays(-2));
      const again = await chat.direct(mia, quinn.userId).catch(() => null);
      if (again) expect(again.id).toBe(old.id);
      const view = (await chatList(mia)).find((c) => c.id === old.id);
      expect(view?.canSend).toBe(false);
      const sendOld = await chat.sendRaw(mia, old.id, { body: 'Còn đó không?' });
      expectStatus(sendOld, 422, 'gửi vào DIRECT với người đã nghỉ');
      expect(ruleOf(sendOld)).toBe('RECIPIENT_INACTIVE');

      expectStatus(
        await chat.call(mia, 'POST', CHAT.direct, { userId: randomUUID() }),
        404,
        'UUID lạ',
      );
    },
  );
});

async function vicView(): Promise<ConversationDto> {
  const c = (await chatList(vic)).find((x) => x.id === direct.id);
  if (!c) throw new Error('Vic không thấy DIRECT');
  return c;
}
async function chatList(who: CompanyActor): Promise<ConversationDto[]> {
  const res = await chat.call(who, 'GET', CHAT.conversations);
  expectStatus(res, 200, 'GET chat/conversations');
  return dataOf<ConversationDto[]>(res);
}
/**
 * Ngày VN lùi `n` ngày. Cho nghỉ việc dùng lastDay = −2 (không phải −1): `access_until` = 06:00 ngày SAU lastDay ⇒ với
 * −1, chạy trước 06:00 sáng người đó vẫn còn quyền (lượt 04:03 ngày 18/10 đỏ 3 ca vì vậy).
 */
function shiftDays(n: number): string {
  return new Date(Date.now() + 7 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
}
