// Seed trò chuyện Mốc 6 (avatar-chat.md §3; T-069): DIRECT Mia↔Vic, nhóm "Dự án Sao Mai", phòng của workspace mẫu,
// ảnh đại diện mẫu sinh bằng sharp (chỉ khi có kho tệp). Dữ liệu bịa; chặn production ở seed.ts.
import { randomUUID } from 'node:crypto';

import sharp from 'sharp';

import type { PrismaClient } from '../src/generated/prisma/client';
import { avatarFileKey } from '../src/core/files/domain/file-key';
import type { IFileStore } from '../src/core/files/ports';
import { directKey } from '../src/modules/chat/domain/chat-conversation';
import { requestHash } from '../src/modules/chat/domain/chat-message';

/** Kho tệp cho ảnh mẫu. Bảng chat tham chiếu `users` ⇒ `TRUNCATE users … CASCADE` của seed-data dọn luôn. */
export type SeedStore = IFileStore;

type Users = Record<'Mia' | 'Vic' | 'Otto' | 'Pam' | 'Olivia', string>;

const MINUTE = 60_000;

async function conversation(
  prisma: PrismaClient,
  data: {
    kind: 'DIRECT' | 'GROUP' | 'WORKSPACE';
    createdById: string;
    title?: string;
    directKey?: string;
    workspaceId?: string;
    members?: [string, 'OWNER' | 'MEMBER'][];
    at: Date;
  },
): Promise<string> {
  const c = await prisma.chatConversation.create({
    data: {
      kind: data.kind,
      createdById: data.createdById,
      title: data.title ?? null,
      directKey: data.directKey ?? null,
      workspaceId: data.workspaceId ?? null,
      createdAt: data.at,
    },
  });
  for (const [userId, role] of data.members ?? []) {
    await prisma.chatParticipant.create({
      data: { conversationId: c.id, userId, role, joinedAt: data.at },
    });
  }
  return c.id;
}

/** Tin theo thứ tự, mỗi tin cách nhau 1 phút; cập nhật `last_message_*` như transaction gửi. */
async function messages(
  prisma: PrismaClient,
  conversationId: string,
  lines: [string, string][],
  start: Date,
): Promise<void> {
  let last: { id: string; at: Date } | undefined;
  for (const [i, [senderId, body]] of lines.entries()) {
    const at = new Date(start.getTime() + i * MINUTE);
    const m = await prisma.chatMessage.create({
      data: {
        conversationId,
        senderId,
        clientMsgId: randomUUID(),
        requestHash: requestHash({ conversationId, body, attachmentIds: [] }),
        body,
        createdAt: at,
      },
    });
    last = { id: m.id, at };
  }
  if (last) {
    await prisma.chatConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: last.at, lastMessageId: last.id },
    });
  }
}

/** Ảnh đại diện mẫu (một màu) — biến thể 256 / 64 WebP, khóa như đường đặt ảnh thật (ADR-142). */
async function seedAvatar(prisma: PrismaClient, store: IFileStore, userId: string, hue: string) {
  const svg = (size: number) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${hue}"/></svg>`,
    );
  for (const size of [256, 64] as const) {
    const data = await sharp(svg(size)).webp({ quality: 82 }).toBuffer();
    await store.delete(avatarFileKey(userId, 1, String(size) as '256' | '64'));
    await store.put(data, {
      maxBytes: data.length,
      key: avatarFileKey(userId, 1, String(size) as '256' | '64'),
    });
  }
  await prisma.user.update({ where: { id: userId }, data: { avatarVersion: 1 } });
}

export async function seedChat(
  prisma: PrismaClient,
  u: Users,
  now: Date,
  store?: IFileStore,
): Promise<void> {
  const start = new Date(now.getTime() - 3 * 60 * MINUTE);
  const dm = await conversation(prisma, {
    kind: 'DIRECT',
    createdById: u.Mia,
    directKey: directKey(u.Mia, u.Vic),
    members: [
      [u.Mia, 'MEMBER'],
      [u.Vic, 'MEMBER'],
    ],
    at: start,
  });
  await messages(
    prisma,
    dm,
    [
      [u.Mia, 'Chào Vic, chiều nay họp lúc mấy giờ nhỉ?'],
      [u.Vic, '3 giờ nhé, phòng họp tầng 2.'],
      [u.Mia, 'Ok, mình sẽ mang bản thiết kế.'],
    ],
    start,
  );

  const group = await conversation(prisma, {
    kind: 'GROUP',
    createdById: u.Mia,
    title: 'Dự án Sao Mai',
    members: [
      [u.Mia, 'OWNER'],
      [u.Vic, 'MEMBER'],
      [u.Otto, 'MEMBER'],
    ],
    at: start,
  });
  await messages(
    prisma,
    group,
    [
      [u.Mia, 'Chào cả nhóm! Tuần này mình chốt phạm vi giai đoạn 1.'],
      [u.Otto, 'Mình gửi danh sách việc trước thứ Tư.'],
    ],
    new Date(start.getTime() + 30 * MINUTE),
  );

  const ws = await prisma.workspace.findFirst({ where: { slug: 'nhom-san-pham' } });
  if (ws) {
    const room = await conversation(prisma, {
      kind: 'WORKSPACE',
      createdById: u.Olivia,
      workspaceId: ws.id,
      at: start,
    });
    await messages(
      prisma,
      room,
      [[u.Pam, 'Nhắc mọi người cập nhật trạng thái task trước 17 giờ.']],
      new Date(start.getTime() + 60 * MINUTE),
    );
  }

  if (store) {
    await seedAvatar(prisma, store, u.Mia, '#4f7cff');
    await seedAvatar(prisma, store, u.Vic, '#1aa179');
  }
}
