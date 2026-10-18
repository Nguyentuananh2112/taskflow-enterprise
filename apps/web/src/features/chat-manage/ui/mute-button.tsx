'use client';

import { Button } from '@/shared/ui/button';

import { useManage } from '../model/use-manage';

type Props = Readonly<{ convId: string; muted: boolean }>;

/** Tắt tiếng (ADR-145): không tính vào tổng chưa đọc trên header; chat không có chuông / email / push. */
export function MuteButton({ convId, muted }: Props) {
  const { mute } = useManage(convId);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={muted}
      loading={mute.isPending}
      onClick={() => mute.mutate(!muted)}
    >
      {muted ? 'Bỏ tắt tiếng' : 'Tắt tiếng'}
    </Button>
  );
}
