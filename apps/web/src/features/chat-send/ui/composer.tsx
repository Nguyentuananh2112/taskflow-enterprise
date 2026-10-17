'use client';

import { CHAT_BODY_MAX_CODE_POINTS, type MessageDto } from '@taskflow/contracts/chat';
import {
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';

import { useRealtimeClient } from '@/shared/socket';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

import { sendErrorText } from '../model/send-errors';
import { draftAttachment, useSendMessage } from '../model/use-send-message';
import { useUploads } from '../model/use-uploads';
import { UploadChips } from './upload-chips';

/** Gửi "đang gõ" tối đa 1 lần / 3 s (server cũng chặn — ADR-145). */
const TYPING_EVERY_MS = 3_000;

type Props = Readonly<{
  convId: string;
  replyTo: MessageDto | null;
  onCancelReply: () => void;
}>;

/** Cảm ứng ⇒ Enter xuống dòng, gửi bằng nút (E10). */
const coarsePointer = () => globalThis.matchMedia?.('(pointer: coarse)').matches === true;

/**
 * Ô soạn tin (avatar-chat.md §7 E10/E11): Enter gửi, BỎ QUA khi đang gõ dấu (`isComposing` — Telex/VNI); dán / kéo-thả
 * tệp; "đang gõ" ≥ 3 s; gửi lạc quan; gửi xong focus lại ô soạn. Nháp chỉ trong state (không lưu trình duyệt).
 */
export function Composer({ convId, replyTo, onCancelReply }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const uploads = useUploads();
  const { send } = useSendMessage(convId);
  const client = useRealtimeClient();
  const lastTyping = useRef(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileId = useId();

  const length = [...text].length;
  const empty = text.trim().length === 0 && uploads.ready.length === 0;
  const blocked = empty || uploads.busy || uploads.hasError || length > CHAT_BODY_MAX_CODE_POINTS;

  const addFiles = (files: readonly File[]) => {
    const errors = uploads.add(files);
    setError(errors.length > 0 ? errors.join(' ') : null);
  };

  const submit = () => {
    if (blocked) return;
    const attachments = uploads.ready.map((c) => draftAttachment(c.result, c.mime));
    const body = text.trim().length > 0 ? text : undefined;
    send(
      {
        ...(body ? { body } : {}),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        attachmentIds: uploads.ready.map((c) => c.result.uploadId),
      },
      attachments,
      replyTo,
    ).catch((e: unknown) => setError(sendErrorText(e)));
    setText('');
    uploads.clear();
    onCancelReply();
    box.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (coarsePointer()) return;
    e.preventDefault();
    submit();
  };

  const onChange = (value: string) => {
    setText(value);
    const now = Date.now();
    if (value && now - lastTyping.current >= TYPING_EVERY_MS) {
      lastTyping.current = now;
      client.sendTyping({ conversationId: convId });
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
  };

  return (
    <div
      className="flex flex-col gap-2 border-t border-border bg-surface p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {replyTo && (
        <div className="flex items-center gap-2 rounded-control bg-bg-subtle px-3 py-1 text-xs">
          <span className="min-w-0 flex-1 truncate">
            Trả lời {replyTo.sender.fullName}: {replyTo.body ?? 'tệp đính kèm'}
          </span>
          <button type="button" onClick={onCancelReply} className="underline">
            Bỏ trả lời
          </button>
        </div>
      )}
      <UploadChips chips={uploads.chips} onRemove={uploads.remove} />
      {error && <Alert>{error}</Alert>}
      <div className="flex items-end gap-2">
        <input
          id={fileId}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <Button
          variant="ghost"
          aria-label="Đính kèm"
          onClick={() => document.getElementById(fileId)?.click()}
        >
          📎
        </Button>
        <textarea
          ref={box}
          aria-label="Soạn tin"
          rows={1}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Nhập tin nhắn…"
          className="max-h-40 min-h-10 flex-1 resize-none rounded-control border border-border bg-surface px-3 py-2 text-sm"
        />
        <Button onClick={submit} disabled={blocked}>
          Gửi
        </Button>
      </div>
      {length > CHAT_BODY_MAX_CODE_POINTS - 200 && (
        <p className="text-right text-xs text-text-muted" aria-live="polite">
          {length} / {CHAT_BODY_MAX_CODE_POINTS} ký tự
        </p>
      )}
    </div>
  );
}
