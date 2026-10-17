'use client';

import { useId, useState, type ChangeEvent } from 'react';

import type { UserWithAvatarDto } from '@/shared/api/pending-contracts/avatar';
import { Alert } from '@/shared/ui/alert';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

import { avatarErrorMessage } from '../model/errors';
import { AVATAR_ACCEPT, decodeAvatar, type AvatarSource } from '../model/image';
import { useRemoveAvatar } from '../model/use-avatar';
import { AvatarCropDialog } from './avatar-crop-dialog';

type Props = Readonly<{ user: UserWithAvatarDto }>;

const PICK_BUTTON =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-bg-subtle peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2';

/**
 * `/account` "Ảnh đại diện" (avatar-chat.md ADR-142, §7 E5): xem ảnh lớn, chọn ảnh ⇒ dialog cắt, gỡ ảnh. Ô chọn tệp có
 * nhãn "Chọn ảnh" (E2E `getByLabel`), MIME cụ thể, không `capture`.
 */
export function AvatarSection({ user }: Props) {
  const inputId = useId();
  const [source, setSource] = useState<AvatarSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = useRemoveAvatar();

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // chọn lại CÙNG tệp vẫn mở dialog
    if (!file) return;
    setError(null);
    try {
      setSource(await decodeAvatar(file));
    } catch (err) {
      setError(avatarErrorMessage(err));
    }
  };

  const closeDialog = () => {
    source?.bitmap.close();
    setSource(null);
  };

  const onRemove = () => {
    setError(null);
    remove.mutate(undefined, {
      onSuccess: () => toast({ title: 'Đã gỡ ảnh đại diện', tone: 'success' }),
      onError: (err) => setError(avatarErrorMessage(err)),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={user.fullName} colorKey={user.id} src={user.avatarUrlLarge} size="lg" />
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            type="file"
            accept={AVATAR_ACCEPT}
            aria-label="Chọn ảnh"
            onChange={(e) => void onPick(e)}
            className="peer sr-only"
          />
          <label htmlFor={inputId} className={PICK_BUTTON}>
            Chọn ảnh
          </label>
          {user.avatarUrl && (
            <Button variant="ghost" onClick={onRemove} loading={remove.isPending}>
              Gỡ ảnh đại diện
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-text-muted">
        Ảnh JPG, PNG hoặc WebP. Ảnh được cắt vuông; mọi người trong công ty đều thấy ảnh này.
      </p>
      {error && <Alert>{error}</Alert>}
      {source && <AvatarCropDialog source={source} onClose={closeDialog} />}
    </div>
  );
}
