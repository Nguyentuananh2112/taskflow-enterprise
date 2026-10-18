// Backend Prisma cho bộ ca hợp đồng store chat (T-069a, tầng I): store Prisma + PrismaUnitOfWork trên Postgres thật —
// cùng hợp đồng `ChatBackend` với bản InMemory. Nhân viên / nghỉ việc / ws dựng thẳng bằng bảng thật.
import { PrismaChatAttachmentStore } from '../../../src/modules/chat/infrastructure/persistence/prisma/prisma-chat-attachment.store';
import { PrismaChatConversationStore } from '../../../src/modules/chat/infrastructure/persistence/prisma/prisma-chat-conversation.store';
import { PrismaChatMessageStore } from '../../../src/modules/chat/infrastructure/persistence/prisma/prisma-chat-message.store';
import type { ChatBackend } from '../../../src/modules/chat/testing/chat-backend';
import { RecordingUnitOfWork, resetDatabase, testPrisma } from '../support/prisma-test-kit';

export async function prismaChatBackend(): Promise<ChatBackend> {
  await resetDatabase();
  const uow = new RecordingUnitOfWork();
  const prisma = testPrisma();
  const db = () => uow.db();
  const person = async (
    userId: string,
    fullName: string,
    since: Date,
    passwordHash: string | null,
  ) => {
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, email: `${userId.slice(-12)}@example.test`, fullName, passwordHash },
      update: { fullName, passwordHash },
    });
    await prisma.companyMember.create({
      data: { userId, role: 'EMPLOYEE', startDate: new Date('2026-01-01'), createdAt: since },
    });
  };
  return {
    conversations: new PrismaChatConversationStore(db),
    messages: new PrismaChatMessageStore(db),
    attachments: new PrismaChatAttachmentStore(db),
    run: (work) => uow.run(work),
    hire: (userId, fullName, since) => person(userId, fullName, since, 'x'),
    hirePending: (userId, fullName, since) => person(userId, fullName, since, null),
    async offboard(userId) {
      await prisma.companyMember.delete({ where: { userId } });
    },
    async setAccessUntil(userId, until) {
      // CHECK offboard_chk: ba cột lịch nghỉ cùng có / cùng không.
      await prisma.companyMember.update({
        where: { userId },
        data:
          until === null
            ? { offboardLastDay: null, offboardAccessUntil: null, offboardScheduledById: null }
            : { offboardLastDay: until, offboardAccessUntil: until, offboardScheduledById: userId },
      });
    },
    async workspace({ id, name, memberIds, active = true }) {
      await prisma.workspace.upsert({
        where: { id },
        create: { id, name, slug: `ws-${id.slice(-6)}`, archivedAt: active ? null : new Date() },
        update: { name, archivedAt: active ? null : new Date() },
      });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: id } });
      await prisma.workspaceMember.createMany({
        data: memberIds.map((userId, i) => ({
          workspaceId: id,
          userId,
          role: i === 0 ? 'OWNER' : 'VIEWER',
        })),
      });
    },
  };
}
