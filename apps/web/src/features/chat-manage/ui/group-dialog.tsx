'use client';

import type { ConversationDetailDto } from '@taskflow/contracts/chat';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { chatErrorText, PeoplePicker } from '@/entities/chat';
import { useSession } from '@/entities/session';
import { Alert } from '@/shared/ui/alert';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';

import { useManage } from '../model/use-manage';

type Props = Readonly<{ detail: ConversationDetailDto; onClose: () => void }>;

/**
 * "Thành viên nhóm" (ADR-143): ai cũng xem + rời; trưởng nhóm đổi tên, thêm / bớt, giao trưởng nhóm. Bị bớt / rời ⇒ mất
 * quyền đọc cả lịch sử (server) — dialog nói rõ trước khi rời.
 */
export function GroupDialog({ detail, onClose }: Props) {
  const router = useRouter();
  const me = useSession().user?.id;
  const ops = useManage(detail.id);
  const [title, setTitle] = useState(detail.title ?? '');
  const owner = detail.myRole === 'OWNER';
  const failed = [ops.rename, ops.add, ops.remove, ops.owner, ops.leave].find((m) => m.isError);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Thành viên nhóm">
      {owner && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ops.rename.mutate(title.trim());
          }}
        >
          <div className="flex-1">
            <Input
              label="Tên nhóm"
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            loading={ops.rename.isPending}
            disabled={!title.trim()}
          >
            Đổi tên
          </Button>
        </form>
      )}
      {owner && (
        <PeoplePicker
          label="Thêm người"
          exclude={new Set(detail.members.map((m) => m.user.id))}
          onPick={(p) => ops.add.mutate([p.id])}
        />
      )}
      <ul aria-label="Thành viên" className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {detail.members.map((m) => (
          <li key={m.user.id} className="flex items-center gap-2 text-sm">
            <Avatar
              name={m.user.fullName}
              colorKey={m.user.id}
              src={m.user.avatarUrl}
              size="sm"
              decorative
            />
            <span className="min-w-0 flex-1 truncate">
              {m.user.fullName}
              {m.role === 'OWNER' && <span className="text-text-muted"> · trưởng nhóm</span>}
              {m.user.id === me && <span className="text-text-muted"> (bạn)</span>}
            </span>
            {owner && m.user.id !== me && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => ops.owner.mutate(m.user.id)}
                  aria-label={`Giao trưởng nhóm cho ${m.user.fullName}`}
                >
                  Giao trưởng nhóm
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => ops.remove.mutate(m.user.id)}
                  aria-label={`Bớt ${m.user.fullName}`}
                >
                  Bớt
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {failed && <Alert>{chatErrorText(failed.error)}</Alert>}
      <p className="text-xs text-text-muted">
        Rời nhóm thì bạn không xem được tin cũ nữa (trừ khi được thêm lại).
      </p>
      <Button
        variant="danger"
        className="self-start"
        loading={ops.leave.isPending}
        onClick={() =>
          ops.leave.mutate(undefined, {
            onSuccess: () => {
              onClose();
              router.replace('/chat');
            },
          })
        }
      >
        Rời nhóm
      </Button>
    </Dialog>
  );
}
