'use client';

import { CHAT_EDIT_WINDOW_SECONDS, type MessageDto } from '@taskflow/contracts/chat';
import { useState } from 'react';

import { cn } from '@/shared/lib/cn';
import { serverClock } from '@/shared/lib/server-clock';
import { Avatar } from '@/shared/ui/avatar';

import { AttachmentView } from './attachment-view';
import { DeleteDialog } from './delete-dialog';
import { EditForm } from './edit-form';
import { MessageBody } from './message-body';

const time = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });

type Props = Readonly<{
  message: MessageDto;
  mine: boolean;
  /** Nhóm / phòng ws: hiện tên + ảnh người gửi. */
  showSender: boolean;
  status: 'sent' | 'pending' | 'failed';
  seen: boolean;
  onReply: (m: MessageDto) => void;
  onRetry: () => void;
  onDiscard: () => void;
}>;

const ACTION = 'underline';

/** Một tin (avatar-chat.md §7 E8, ADR-144/146). `data-testid=chat-message-<id>` cho E2E (E13). */
export function MessageItem(props: Props) {
  const { message: m, mine, showSender, status, seen, onReply, onRetry, onDiscard } = props;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const deleted = m.deletedAt !== null;
  // Gợi ý phía client; server vẫn quyết (422 EDIT_WINDOW_PASSED).
  const editable =
    mine &&
    !deleted &&
    status === 'sent' &&
    serverClock.now() - Date.parse(m.createdAt) < CHAT_EDIT_WINDOW_SECONDS * 1000;
  const sender = showSender && !mine;

  return (
    <article
      data-testid={`chat-message-${m.id}`}
      aria-label={`${m.sender.fullName}, ${time.format(new Date(m.createdAt))}`}
      className={cn('group flex gap-2', mine && 'flex-row-reverse')}
    >
      {sender && (
        <Avatar
          name={m.sender.fullName}
          colorKey={m.sender.id}
          src={m.sender.avatarUrl}
          size="sm"
          decorative
          loading="lazy"
        />
      )}
      <div className={cn('flex max-w-[80%] flex-col gap-1', mine && 'items-end')}>
        {sender && <span className="text-xs font-medium text-text-muted">{m.sender.fullName}</span>}
        {m.replyTo && (
          <blockquote className="border-l-2 border-border pl-2 text-xs text-text-muted">
            {m.replyTo.sender.fullName}:{' '}
            {m.replyTo.deleted ? 'Tin nhắn đã bị xóa' : (m.replyTo.bodyPreview ?? 'Tệp đính kèm')}
          </blockquote>
        )}
        <div
          className={cn(
            'rounded-card px-3 py-2 text-sm',
            mine ? 'bg-primary text-primary-fg' : 'bg-bg-subtle',
            deleted && 'italic opacity-70',
          )}
        >
          {deleted ? (
            'Tin nhắn đã bị xóa'
          ) : editing ? (
            <EditForm message={m} onDone={() => setEditing(false)} />
          ) : (
            m.body && <MessageBody body={m.body} />
          )}
          {!deleted && m.attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <AttachmentView key={a.id} attachment={a} convId={m.conversationId} />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <time dateTime={m.createdAt}>{time.format(new Date(m.createdAt))}</time>
          {m.editedAt && !deleted && <span>(đã sửa)</span>}
          {status === 'pending' && <span>Đang gửi…</span>}
          {seen && <span>Đã xem</span>}
          {status === 'failed' && (
            <span role="alert" className="flex gap-2 text-danger">
              Chưa gửi được
              <button type="button" className={ACTION} onClick={onRetry}>
                Thử lại
              </button>
              <button type="button" className={ACTION} onClick={onDiscard}>
                Bỏ
              </button>
            </span>
          )}
          {!deleted && status === 'sent' && !editing && (
            <span className="flex gap-2 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              <button
                type="button"
                className={ACTION}
                onClick={() => onReply(m)}
                aria-label={`Trả lời tin của ${m.sender.fullName}`}
              >
                Trả lời
              </button>
              {editable && (
                <button type="button" className={ACTION} onClick={() => setEditing(true)}>
                  Sửa
                </button>
              )}
              {mine && (
                <button type="button" className={ACTION} onClick={() => setConfirming(true)}>
                  Xóa
                </button>
              )}
            </span>
          )}
        </div>
      </div>
      {confirming && <DeleteDialog message={m} onClose={() => setConfirming(false)} />}
    </article>
  );
}
