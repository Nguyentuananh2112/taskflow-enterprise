import { useMutation } from '@tanstack/react-query';

import { privacyApi, privacyKeys } from '@/entities/privacy';
import { isApiError } from '@/shared/api';

/**
 * "Tôi đã đọc" — gửi phiên bản ĐANG HIỂN THỊ. Server đã có bản mới (409 RESOURCE_CONFLICT `privacy_version_outdated`)
 * ⇒ tải lại để người dùng đọc nội dung mới rồi xác nhận lại.
 */
export function useAckPrivacy() {
  const ack = useMutation({
    mutationFn: (version: number) => privacyApi.ack(version),
    onSuccess: (next, _v, _r, context) => context.client.setQueryData(privacyKeys.me(), next),
    onError: (error, _v, _r, context) => {
      if (isApiError(error, 'RESOURCE_CONFLICT')) {
        void context.client.invalidateQueries({ queryKey: privacyKeys.me() });
      }
    },
  });
  const outdated = isApiError(ack.error, 'RESOURCE_CONFLICT');
  return { ack, outdated };
}
