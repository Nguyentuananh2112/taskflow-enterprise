import { requestHash } from '../domain/chat-message';
import type { AttachmentRecord } from '../application/ports/chat-message.port';
import type { ChatBackend } from './chat-backend';

// Dữ liệu dựng chung cho bộ ca hợp đồng store chat (T-069a). Mốc: nhân viên vào 2026-01-01; "now" 2026-10-18.

export const U = {
  Mia: '00000000-0000-7000-8000-00000000c001',
  Vic: '00000000-0000-7000-8000-00000000c002',
  Lan: '00000000-0000-7000-8000-00000000c003',
  Pending: '00000000-0000-7000-8000-00000000c004',
} as const;
export const WS = '00000000-0000-7000-8000-00000000c0a1';
export const HIRED = new Date('2026-01-01T00:00:00Z');
export const NOW = new Date('2026-10-18T03:00:00Z');
export const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
export const cid = (n: number) =>
  `00000000-0000-7000-8000-0000000cc${n.toString().padStart(3, '0')}`;

export async function staff(b: ChatBackend): Promise<void> {
  await b.hire(U.Mia, 'Mia Trần', HIRED);
  await b.hire(U.Vic, 'Vic Lê', HIRED);
  await b.hire(U.Lan, 'Lan Phạm', HIRED);
  await b.hirePending(U.Pending, 'Mai Chờ', HIRED);
}

export const mid = (n: number) =>
  `00000000-0000-7000-8000-0000000dd${n.toString().padStart(3, '0')}`;
export const cmid = (n: number) =>
  `00000000-0000-7000-8000-0000000ee${n.toString().padStart(3, '0')}`;
export const aid = (n: number) =>
  `00000000-0000-7000-8000-0000000ff${n.toString().padStart(3, '0')}`;
export const G = cid(50);
export const hex = (c: string) => c.repeat(64);

export async function group(b: ChatBackend) {
  await staff(b);
  await b.run(() =>
    b.conversations.createGroup({
      id: G,
      title: 'G',
      createdById: U.Mia,
      memberIds: [U.Vic, U.Lan],
      at: NOW,
    }),
  );
}

export function send(
  b: ChatBackend,
  n: number,
  sender: string,
  body: string | null,
  extra: { attachmentIds?: string[]; replyToId?: string; atMin?: number; clientN?: number } = {},
) {
  const attachmentIds = extra.attachmentIds ?? [];
  return b.run(() =>
    b.messages.insert({
      id: mid(n),
      conversationId: G,
      senderId: sender,
      clientMsgId: cmid(extra.clientN ?? n),
      requestHash: requestHash({ conversationId: G, body, attachmentIds }),
      body,
      replyToId: extra.replyToId ?? null,
      attachmentIds,
      at: at(extra.atMin ?? n),
    }),
  );
}

export function upload(
  b: ChatBackend,
  n: number,
  uploader: string,
  minute = 0,
): Promise<AttachmentRecord> {
  return b.run(() =>
    b.attachments.createUpload({
      id: aid(n),
      uploaderId: uploader,
      kind: 'IMAGE',
      name: `ảnh ${String(n)}.png`,
      mime: 'image/webp',
      sizeBytes: 1234,
      sha256: hex('a'),
      width: 640,
      height: 480,
      fileKey: `k${String(n)}f`,
      previewKey: `k${String(n)}p`,
      thumbKey: `k${String(n)}t`,
      createdAt: at(minute),
    }),
  );
}
