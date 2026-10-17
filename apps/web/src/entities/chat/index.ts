// Public API của trò chuyện (avatar-chat.md §7).
export { linkify, type Segment } from './lib/linkify';
export { chatApi, type SendInput, type UploadInput } from './api/chat.api';
export {
  appendMessages,
  dropMessage,
  flatten,
  newestMessage,
  upsertMessage,
  type MessagePage,
  type MessagesData,
} from './model/message-cache';
export {
  chatKeys,
  useChatPeople,
  useChatUnread,
  useConversation,
  useConversations,
  useMessages,
} from './model/use-chat';
