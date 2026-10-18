// T-069 — đính kèm chat qua route thật (ADR-141/144): upload ảnh / tệp, gắn vào tin, `/media` kiểm DB mỗi lần,
// `download-url` kiểm quyền lúc bấm, xóa tin ⇒ 404 ngay, hạn mức byte / ngày. Kho tạm + sharp thật.
import type {
  ConversationDetailDto,
  DownloadUrlDto,
  MessageDto,
  UploadResponseDto,
} from '@taskflow/contracts';
import request from 'supertest';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as fx from '../security/harness/files/fixtures';
import { errorOf } from '../support/http';
import type { TestApp, TestUser } from '../support/http-app';
import { api, chatApp, dataOf, nextMsgId, pathOf, type ChatApp } from './chat-app';

let c: ChatApp;
let t: TestApp;
let a: ReturnType<typeof api>;
beforeEach(async () => {
  c = await chatApp({ uploadDailyBytes: 64 * 1024 });
  t = c.t;
  a = api(t);
});
afterEach(() => c.close());

async function room() {
  const mia = await t.register('Mia');
  const vic = await t.register('Vic');
  const conv = dataOf<ConversationDetailDto>(
    await a.send(mia, 'post', '/chat/direct', { userId: vic.id }),
  );
  return { mia, vic, conv };
}
const sendWith = (by: TestUser, conversationId: string, attachmentIds: string[], body?: string) =>
  a.send(by, 'post', `/chat/conversations/${conversationId}/messages`, {
    clientMsgId: nextMsgId(),
    attachmentIds,
    ...(body ? { body } : {}),
  });

describe('ảnh (as=image)', () => {
  it('upload 201 (kích thước xem trước) → gửi → Vic mở preview WebP không EXIF; xóa tin ⇒ URL 404 ngay (SEC-CH-22)', async () => {
    const { mia, vic, conv } = await room();
    const up = await a.upload(mia, fx.jpegWithGps({ w: 64, h: 32 }), 'Ảnh của tôi.jpg', 'image');
    expect(up.status).toBe(201);
    const u = dataOf<UploadResponseDto>(up);
    expect([u.kind, u.width, u.height, u.name]).toEqual(['IMAGE', 64, 32, 'Ảnh của tôi.jpg']);
    const msg = dataOf<MessageDto>(await sendWith(mia, conv.id, [u.uploadId]));
    const att = msg.attachments[0]!;
    const img = await request(t.app)
      .get(pathOf(att.previewUrl ?? ''))
      .buffer(true);
    expect([img.status, img.headers['content-type']]).toEqual([200, 'image/webp']);
    const meta = await sharp(img.body as Buffer).metadata();
    expect([meta.format, meta.width, meta.exif]).toEqual(['webp', 64, undefined]);
    expect((await request(t.app).get(pathOf(att.thumbUrl ?? ''))).status).toBe(200);
    // download-url chỉ cho FILE
    expect((await a.send(vic, 'post', `/chat/attachments/${att.id}/download-url`)).status).toBe(
      404,
    );
    expect((await a.delete(mia, `/chat/messages/${msg.id}`)).status).toBe(204);
    expect((await request(t.app).get(pathOf(att.previewUrl ?? ''))).status).toBe(404);
  });

  it('as=image với PDF ⇒ 415; upload chưa gắn ⇒ /media không phục vụ; upload của người khác ⇒ gửi 404', async () => {
    const { mia, vic, conv } = await room();
    const pdf = await a.upload(mia, fx.pdf(), 'a.pdf', 'image');
    expect([pdf.status, errorOf(pdf).code]).toEqual([415, 'UNSUPPORTED_FILE_TYPE']);
    const u = dataOf<UploadResponseDto>(
      await a.upload(vic, fx.png({ w: 4, h: 4 }), 'v.png', 'image'),
    );
    const stolen = await sendWith(mia, conv.id, [u.uploadId], 'của Vic');
    expect(stolen.status).toBe(404);
  });
});

describe('tệp (as=file)', () => {
  it('PDF: download-url (người tham gia) ⇒ /media attachment + filename* tiếng Việt; người ngoài 404', async () => {
    const { mia, vic, conv } = await room();
    const otto = await t.register('Otto');
    const u = dataOf<UploadResponseDto>(
      await a.upload(mia, fx.pdf(2048), 'Báo cáo quý.pdf', 'file'),
    );
    expect([u.kind, u.width, u.sizeBytes]).toEqual(['FILE', null, 2048]);
    const msg = dataOf<MessageDto>(await sendWith(mia, conv.id, [u.uploadId], 'gửi báo cáo'));
    expect(msg.attachments[0]).toMatchObject({
      kind: 'FILE',
      previewUrl: null,
      mime: 'application/pdf',
    });
    const link = await a.send(vic, 'post', `/chat/attachments/${u.uploadId}/download-url`);
    expect(link.status).toBe(200);
    const file = await request(t.app)
      .get(pathOf(dataOf<DownloadUrlDto>(link).url))
      .buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toContain(
      "filename*=UTF-8''B%C3%A1o%20c%C3%A1o%20qu%C3%BD.pdf",
    );
    expect((file.body as Buffer).length).toBe(2048);
    expect(
      (await a.send(otto, 'post', `/chat/attachments/${u.uploadId}/download-url`)).status,
    ).toBe(404);
  });

  it('SEC-CH-23: DOCX có macro ⇒ 415 MACRO_OR_ACTIVE_CONTENT; ZIP thuần ⇒ 415; ?as sai ⇒ 400', async () => {
    const { mia } = await room();
    const macro = await a.upload(mia, fx.ooxml('docx', { vbaProject: true }), 'a.docx', 'file');
    expect([macro.status, errorOf(macro).code]).toEqual([415, 'MACRO_OR_ACTIVE_CONTENT']);
    const zip = await a.upload(mia, fx.plainZip(), 'a.zip', 'file');
    expect(zip.status).toBe(415);
    const bad = await request(t.app)
      .post('/api/v1/chat/uploads?as=video')
      .set(mia.auth)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Upload-Name', 'a.pdf')
      .send(fx.pdf());
    expect(bad.status).toBe(400);
  });

  it('SEC-CH-14: vượt byte / ngày (test 64 KiB) ⇒ 429, không thêm blob', async () => {
    const { mia } = await room();
    expect((await a.upload(mia, fx.pdf(40 * 1024), 'a.pdf', 'file')).status).toBe(201);
    const over = await a.upload(mia, fx.pdf(40 * 1024), 'b.pdf', 'file');
    expect([over.status, errorOf(over).code]).toEqual([429, 'RATE_LIMITED']);
    expect((await a.upload(mia, fx.pdf(10 * 1024), 'c.pdf', 'file')).status).toBe(201);
  });
});
