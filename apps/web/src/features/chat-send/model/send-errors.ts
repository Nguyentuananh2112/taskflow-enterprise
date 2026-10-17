import { CLIENT_ERROR_CODES, isApiError } from '@/shared/api';

// Lỗi gửi tin bằng lời thường (ADR-144 — 422 BUSINESS_RULE_VIOLATION + details.rule).

const BY_RULE: Readonly<Record<string, string>> = {
  RECIPIENT_INACTIVE: 'Người này không còn ở công ty — chỉ xem được tin cũ.',
  TOO_MANY_ATTACHMENTS: 'Tối đa 10 tệp mỗi tin.',
  REPLY_OTHER_CONVERSATION: 'Không trả lời được tin này.',
  IDEMPOTENCY_KEY_REUSED: 'Tin đã gửi trước đó khác nội dung — hãy gửi lại.',
  NOT_ACTIVE_MEMBER: 'Bạn không còn ở cuộc trò chuyện này.',
  ATTACHMENT_UNAVAILABLE: 'Tệp đính kèm không còn trên máy chủ — hãy đính kèm lại.',
};

export function sendErrorText(error: unknown): string {
  if (!isApiError(error)) return 'Chưa gửi được tin — thử lại.';
  const rule =
    typeof error.details === 'object' && error.details !== null && 'rule' in error.details
      ? String(error.details.rule)
      : '';
  if (BY_RULE[rule]) return BY_RULE[rule];
  if (error.code === 'RATE_LIMITED') return 'Bạn gửi quá nhanh, chờ một chút rồi thử lại.';
  if (error.code === CLIENT_ERROR_CODES.network)
    return 'Mất kết nối — tin chưa gửi, bấm "Thử lại" khi có mạng.';
  if (error.status === 404) return 'Bạn không còn ở cuộc trò chuyện này.';
  return 'Chưa gửi được tin — thử lại.';
}
