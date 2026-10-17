// Port do module chat ĐỊNH NGHĨA, bên ngoài hiện thực — nối ở composition root (ADR-093; T-069, G).
import type { MessageDto } from '@taskflow/contracts';

/** `UserRefDto` cho người gửi / người kia / thành viên. Người đã nghỉ ⇒ `avatarUrl: null` (ADR-142). */
export interface ChatUserRef {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUrl: string | null;
}

/** Tên + ảnh theo lô — MỘT lần đọc cho cả trang. Id không còn trong DB ⇒ không có trong Map. */
export interface IChatUserRefs {
  refsOf(ids: readonly string[]): Promise<ReadonlyMap<string, ChatUserRef>>;
}

/** Kho tệp + URL ký cho đính kèm (ADR-141). Repo trả KHÓA blob, use case ký ở đây. */
export interface IChatMedia {
  /** Ảnh (IMAGE): URL ký theo khung 1 giờ. */
  imageUrls(attachmentId: string): { previewUrl: string; thumbUrl: string };
  /** `download-url`: purpose `download`, hạn 60 s. */
  downloadUrl(attachmentId: string): string;
  /** Sau commit (xóa tin / retention); lỗi ⇒ files-sweep dọn blob không còn tham chiếu. */
  deleteBlobs(keys: readonly string[]): Promise<void>;
}

/**
 * Sự kiện sau commit (ADR-145). T-069 nối no-op; T-070 tính người nhận (`recipientIds`, lọc công ty hoạt động) và
 * phát tới `user:{id}`. Lỗi phát không đổi kết quả của lệnh.
 */
export interface IChatNotifier {
  messageCreated(e: {
    conversationId: string;
    message: MessageDto;
    actorId: string;
  }): Promise<void>;
  messageUpdated(e: {
    conversationId: string;
    message: MessageDto;
    actorId: string;
  }): Promise<void>;
  read(e: { conversationId: string; userId: string; messageId: string }): Promise<void>;
  /** Đổi tên / thêm / bớt / giao OWNER / tạo mới — người nhận tự tải lại `GET chat/conversations/:id`. */
  conversationUpdated(e: { conversationId: string; actorId: string }): Promise<void>;
  /** Người bị bớt / tự rời: chỉ những người đó (họ không còn trong `recipientIds`). */
  conversationRemoved(e: {
    conversationId: string;
    userIds: readonly string[];
    actorId: string;
  }): Promise<void>;
}

export const noopChatNotifier: IChatNotifier = {
  messageCreated: () => Promise.resolve(),
  messageUpdated: () => Promise.resolve(),
  read: () => Promise.resolve(),
  conversationUpdated: () => Promise.resolve(),
  conversationRemoved: () => Promise.resolve(),
};
