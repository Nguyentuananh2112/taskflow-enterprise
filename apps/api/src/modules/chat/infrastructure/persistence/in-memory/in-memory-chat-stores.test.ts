import { inMemoryChatBackend } from '../../../testing/chat-backend';
import { describeChatConversationContract } from '../../../testing/chat-conversation.contract';
import { describeChatMessageContract } from '../../../testing/chat-message.contract';

// T-069a: bộ ca hợp đồng trên InMemory (bản Prisma chạy cùng bộ ca ở test/integration/chat).
describeChatConversationContract('InMemory', () => Promise.resolve(inMemoryChatBackend()));
describeChatMessageContract('InMemory', () => Promise.resolve(inMemoryChatBackend()));
