import type { ConversationRecord } from '../../../application/ports/chat-conversation.port';
import type { ConversationKind } from '../../../domain/chat-conversation';

type Row = {
  id: string;
  kind: ConversationKind;
  title: string | null;
  directKey: string | null;
  workspaceId: string | null;
  createdById: string;
  lastMessageAt: Date | null;
  lastMessageId: string | null;
  createdAt: Date;
};

export const toRecord = (r: Row): ConversationRecord => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  directKey: r.directKey,
  workspaceId: r.workspaceId,
  createdById: r.createdById,
  lastMessageAt: r.lastMessageAt,
  lastMessageId: r.lastMessageId,
  createdAt: r.createdAt,
});
