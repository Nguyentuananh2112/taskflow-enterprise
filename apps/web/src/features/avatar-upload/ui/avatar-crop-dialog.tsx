'use client';

import { useRef, useState } from 'react';

import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';

import { INITIAL_CROP, sourceRect, type Crop } from '../model/crop';
import { avatarErrorMessage } from '../model/errors';
import { exportAvatar, type AvatarSource } from '../model/image';
import { useUploadAvatar } from '../model/use-avatar';
import { AvatarCropper, VIEW_PX } from './avatar-cropper';

type Props = Readonly<{
  source: AvatarSource;
  /** Đóng (Hủy / Esc / lưu xong) — chủ sở hữu giải phóng ảnh. */
  onClose: () => void;
}>;

/** Cắt rồi lưu: xuất JPEG 512 ⇒ upload XHR có tiến độ, Hủy ⇒ hủy upload đang chạy (§7 E2/E4). */
export function AvatarCropDialog({ source, onClose }: Props) {
  const [crop, setCrop] = useState<Crop>(INITIAL_CROP);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useUploadAvatar();
  const abort = useRef<AbortController | null>(null);

  const close = () => {
    abort.current?.abort();
    onClose();
  };

  const save = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setProgress(0);
    setError(null);
    try {
      const blob = await exportAvatar(source, sourceRect(source, VIEW_PX, crop));
      await upload.mutateAsync({ blob, onProgress: setProgress, signal: controller.signal });
      toast({ title: 'Đã cập nhật ảnh đại diện', tone: 'success' });
      onClose();
    } catch (e) {
      // Hủy ⇒ dialog đã đóng, không báo lỗi.
      if (!controller.signal.aborted) setError(avatarErrorMessage(e));
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  const busy = progress !== null;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title="Cắt ảnh đại diện"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Hủy
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={busy}>
            Lưu ảnh đại diện
          </Button>
        </>
      }
    >
      <AvatarCropper source={source} crop={crop} onCropChange={setCrop} />
      {busy && (
        <progress
          aria-label="Đang tải ảnh lên"
          max={1}
          value={progress}
          className="h-2 w-full accent-primary"
        />
      )}
      {error && !busy && <Alert>{error}</Alert>}
    </Dialog>
  );
}
