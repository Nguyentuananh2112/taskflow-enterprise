'use client';

import type { AttachmentDto } from '@taskflow/contracts/chat';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { chatKeys } from '@/entities/chat';
import { isApiMediaUrl } from '@/shared/lib/media-url';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';

import { useDownload } from '../model/use-message-actions';

/** URL ảnh hết khung ⇒ tải lại trang tin chứa nó MỘT lần / id (E1) — lỗi lần nữa thì để ô xám. */
const refreshedOnce = new Set<string>();

const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

type Props = Readonly<{ attachment: AttachmentDto; convId: string }>;

/**
 * Ảnh: thumb giữ chỗ bằng width/height (E8 — không nhảy khi cuộn), bấm ⇒ dialog "Xem ảnh". Tệp: tên (text), cỡ, nút
 * "Tải xuống <tên>". Ảnh đang tải lên (chưa có URL) ⇒ ô giữ chỗ.
 */
export function AttachmentView({ attachment: a, convId }: Props) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const download = useDownload();

  if (a.kind === 'IMAGE') {
    // B L2: chỉ URL của chính API (/media/chat) mới vào <img>; khác ⇒ ô giữ chỗ, không mở xem.
    const thumb = isApiMediaUrl(a.thumbUrl, 'chat') ? a.thumbUrl : null;
    const preview = isApiMediaUrl(a.previewUrl, 'chat') ? a.previewUrl : null;
    const w = a.width ?? 320;
    const h = a.height ?? 240;
    const scale = Math.min(1, 240 / Math.max(w, h));
    const box = { width: Math.round(w * scale), height: Math.round(h * scale) };
    const onError = () => {
      if (refreshedOnce.has(a.id)) return;
      refreshedOnce.add(a.id);
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(convId) });
    };
    return (
      <>
        <button
          type="button"
          onClick={() => preview && setOpen(true)}
          aria-label={`Xem ảnh ${a.name}`}
        >
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL ký có hạn của API, không qua next/image
            <img
              src={thumb}
              alt={a.name}
              {...box}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={onError}
              className="rounded-card bg-bg-subtle object-cover"
            />
          ) : (
            // Ảnh vừa gửi, chưa có URL ký ⇒ ô giữ chỗ cỡ cố định (không dùng style — CSP W-CSP-2).
            <span
              aria-hidden="true"
              className="block h-40 w-56 animate-pulse rounded-card bg-bg-subtle"
            />
          )}
        </button>
        {open && preview && (
          <Dialog open onOpenChange={setOpen} title="Xem ảnh" className="max-w-3xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL ký có hạn */}
            <img
              src={preview}
              alt={a.name}
              width={a.width ?? undefined}
              height={a.height ?? undefined}
              referrerPolicy="no-referrer"
              onError={onError}
              className="max-h-[70vh] w-auto object-contain"
            />
          </Dialog>
        )}
      </>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm">
      <span aria-hidden="true">📄</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{a.name}</span>
        <span className="text-xs text-text-muted">{sizeText(a.sizeBytes)}</span>
      </span>
      <Button
        size="sm"
        variant="secondary"
        aria-label={`Tải xuống ${a.name}`}
        loading={download.isPending}
        onClick={() => download.mutate(a.id)}
      >
        Tải xuống
      </Button>
      {download.isError && (
        <span role="alert" className="text-xs text-danger">
          Tệp không còn — hãy tải lại trang.
        </span>
      )}
    </div>
  );
}
