import { CHAT_FILE_MAX_BYTES, CHAT_MAX_ATTACHMENTS } from '@taskflow/contracts/common';
import type { UploadResponseDto } from '@taskflow/contracts/chat';
import { useCallback, useEffect, useRef, useState } from 'react';

import { chatApi } from '@/entities/chat';
import { CLIENT_ERROR_CODES, isApiError } from '@/shared/api';

// Tệp đính kèm trong ô soạn (avatar-chat.md §7 E2/E11): kiểm 20 MB / 10 tệp / loại PHÍA CLIENT trước (server vẫn kiểm
// lại); tải ngay khi chọn bằng XHR có tiến độ + hủy; ảnh có bản xem trước (object URL — revoke khi gỡ / gửi / rời).

export type Chip = {
  key: string;
  name: string;
  kind: 'image' | 'file';
  progress: number;
  /** object URL của ảnh (xem trước trước khi có URL ký). */
  preview: string | null;
  result: UploadResponseDto | null;
  error: string | null;
  mime: string;
  controller: AbortController;
};

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
/** Đuôi bị cấm (ADR-141: nén, chạy được, HTML/SVG) — báo sớm, server vẫn kiểm theo nội dung. */
const BLOCKED =
  /\.(zip|rar|7z|gz|tar|exe|msi|bat|cmd|sh|js|html?|svg|xml|apk|dmg|docm|xlsm|pptm)$/i;

export const uploadErrorText = (error: unknown): string => {
  if (!isApiError(error)) return 'Chưa tải lên được.';
  const code = error.serverCode ?? error.code;
  if (code === 'PAYLOAD_TOO_LARGE') return 'Tệp lớn hơn 20 MB.';
  if (code === 'MACRO_OR_ACTIVE_CONTENT')
    return 'Tệp có macro hoặc nội dung chủ động — không gửi được.';
  if (code === 'UNSUPPORTED_FILE_TYPE' || code === 'UNSUPPORTED_MEDIA_TYPE')
    return 'Loại tệp này không gửi được.';
  if (code === 'STORAGE_FULL') return 'Kho lưu trữ đã đầy — hãy báo quản trị viên.';
  // 429 có hai nguồn: gửi dồn dập, hoặc hết hạn mức 200 MB/ngày (Retry-After tới 0 giờ VN — T-069).
  if (code === 'RATE_LIMITED')
    return 'Bạn đã gửi quá nhiều tệp — thử lại sau. Hạn mức 200 MB mỗi ngày tính lại lúc 0 giờ.';
  if (code === CLIENT_ERROR_CODES.network) return 'Mất kết nối — thử lại.';
  return 'Chưa tải lên được.';
};

/** Lý do không nhận tệp phía client, hoặc null. */
export function rejectReason(file: File, count: number): string | null {
  if (count >= CHAT_MAX_ATTACHMENTS) return `Tối đa ${CHAT_MAX_ATTACHMENTS} tệp mỗi tin.`;
  if (file.size > CHAT_FILE_MAX_BYTES) return `"${file.name}" lớn hơn 20 MB.`;
  if (BLOCKED.test(file.name)) return `"${file.name}" là loại tệp không gửi được.`;
  return null;
}

export function useUploads() {
  const [chips, setChips] = useState<Chip[]>([]);
  const live = useRef<Chip[]>([]);
  useEffect(() => {
    live.current = chips; // bản mới nhất cho add/remove/cleanup (không ghi ref lúc render)
  });

  const update = (key: string, change: Partial<Chip>) =>
    setChips((list) => list.map((c) => (c.key === key ? { ...c, ...change } : c)));

  /** Trả các lý do bị từ chối (để báo một lần). */
  const add = useCallback((files: readonly File[]): string[] => {
    const errors: string[] = [];
    const accepted: Chip[] = [];
    for (const file of files) {
      const reason = rejectReason(file, live.current.length + accepted.length);
      if (reason) {
        errors.push(reason);
        continue;
      }
      const image = IMAGE_TYPES.has(file.type);
      const chip: Chip = {
        key: crypto.randomUUID(),
        name: file.name || 'tep',
        kind: image ? 'image' : 'file',
        progress: 0,
        preview: image ? URL.createObjectURL(file) : null,
        result: null,
        error: null,
        mime: file.type,
        controller: new AbortController(),
      };
      accepted.push(chip);
      chatApi
        .upload({
          file,
          name: chip.name,
          as: chip.kind,
          onProgress: (p) => update(chip.key, { progress: p }),
          signal: chip.controller.signal,
        })
        .then((result) => update(chip.key, { result, progress: 1 }))
        .catch((error: unknown) => {
          if (!chip.controller.signal.aborted) update(chip.key, { error: uploadErrorText(error) });
        });
    }
    setChips((list) => [...list, ...accepted]);
    return errors;
  }, []);

  const remove = useCallback((key: string) => {
    const chip = live.current.find((c) => c.key === key);
    chip?.controller.abort();
    if (chip?.preview) URL.revokeObjectURL(chip.preview);
    setChips((list) => list.filter((c) => c.key !== key));
  }, []);

  /** Sau khi gửi: bỏ chip, giải phóng bản xem trước. */
  const clear = useCallback(() => {
    live.current.forEach((c) => c.preview && URL.revokeObjectURL(c.preview));
    setChips([]);
  }, []);

  // Rời hội thoại / đóng trang: hủy tải dở + revoke (E11).
  useEffect(
    () => () =>
      live.current.forEach((c) => {
        c.controller.abort();
        if (c.preview) URL.revokeObjectURL(c.preview);
      }),
    [],
  );

  const busy = chips.some((c) => !c.result && !c.error);
  const ready = chips.filter((c): c is Chip & { result: UploadResponseDto } => c.result !== null);
  return { chips, add, remove, clear, busy, ready, hasError: chips.some((c) => c.error) };
}
