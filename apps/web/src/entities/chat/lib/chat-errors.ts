import { isApiError } from '@/shared/api';

// Lỗi trò chuyện bằng lời thường (ADR-143/144 — 422 BUSINESS_RULE_VIOLATION + details.rule; 403 / 404).

const BY_RULE: Readonly<Record<string, string>> = {
  SELF_DIRECT: 'Không nhắn cho chính mình được.',
  RECIPIENT_INACTIVE: 'Người này chưa kích hoạt tài khoản hoặc không còn ở công ty.',
  NOT_ACTIVE_MEMBER: 'Có người chưa kích hoạt tài khoản hoặc không còn ở công ty.',
  GROUP_TOO_LARGE: 'Nhóm tối đa 100 người.',
  NOT_GROUP: 'Chỉ áp dụng cho nhóm.',
};

export function chatErrorText(error: unknown, fallback = 'Chưa làm được — thử lại.'): string {
  if (!isApiError(error)) return fallback;
  const details = error.details;
  const rule =
    typeof details === 'object' && details !== null && 'rule' in details
      ? String(details.rule)
      : '';
  if (BY_RULE[rule]) return BY_RULE[rule];
  if (error.status === 403) return 'Chỉ trưởng nhóm làm được việc này.';
  if (error.status === 404) return 'Không còn tìm thấy cuộc trò chuyện hoặc người này.';
  if (error.code === 'RATE_LIMITED') return 'Bạn thao tác quá nhanh, thử lại sau ít phút.';
  return fallback;
}
