import { linkify } from '@/entities/chat';

/** Thân tin: văn bản thuần (text node), giữ xuống dòng; link chỉ http(s), mở tab mới an toàn (ADR-146). */
export function MessageBody({ body }: Readonly<{ body: string }>) {
  return (
    <p className="whitespace-pre-wrap break-words">
      {linkify(body).map((seg, i) =>
        seg.kind === 'link' ? (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline"
          >
            {seg.text}
          </a>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
}
