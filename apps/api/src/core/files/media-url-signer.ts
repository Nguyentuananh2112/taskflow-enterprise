import type { IClock } from '../domain';
import type { AvatarVariant } from './domain/file-key';
import {
  bucketExpiry,
  signMedia,
  type MediaKind,
  type MediaTuple,
  type MediaVariant,
} from './domain/media-signature';

export interface MediaUrlConfig {
  /** Origin công khai của API (vd `https://api.example.vn`) — contract cần URL tuyệt đối. */
  baseUrl: string;
  /** Chỉ khóa HIỆN TẠI ký; `_PREVIOUS` chỉ để kiểm (ADR-141, B M3). */
  secret: string;
  /** Khung `exp` (ADR-141): avatar 24 giờ, ảnh chat 1 giờ; URL tải tệp sống 60 s. Chỉnh được ở test. */
  avatarBucketSec: number;
  imageBucketSec: number;
  downloadTtlSec: number;
}

/**
 * Phát URL ký cho `/api/v1/media/<kind>/<id>/<variant>?v&exp&sig` (ADR-141). Use case chỉ gọi khi người xem
 * ĐÃ có quyền; `/media` vẫn kiểm DB mỗi lần (xóa ⇒ 404 ngay dù URL còn hạn).
 */
export class MediaUrlSigner {
  constructor(
    private readonly config: MediaUrlConfig,
    private readonly clock: IClock,
  ) {}

  avatarUrl(userId: string, version: number, variant: AvatarVariant): string {
    const exp = bucketExpiry(this.#nowSec(), this.config.avatarBucketSec);
    return this.#url({ kind: 'avatars', id: userId, variant, version, exp });
  }

  chatImageUrl(attachmentId: string, variant: 'preview' | 'thumb'): string {
    const exp = bucketExpiry(this.#nowSec(), this.config.imageBucketSec);
    return this.#url({ kind: 'chat', id: attachmentId, variant, version: 1, exp });
  }

  /** `POST chat/attachments/:id/download-url` — hạn ngắn, không theo khung. */
  downloadUrl(attachmentId: string): string {
    const exp = this.#nowSec() + this.config.downloadTtlSec;
    return this.#url({ kind: 'chat', id: attachmentId, variant: 'file', version: 1, exp });
  }

  #nowSec(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }

  #url(t: MediaTuple & { kind: MediaKind; variant: MediaVariant }): string {
    const sig = signMedia(this.config.secret, t);
    const path = `/api/v1/media/${t.kind}/${encodeURIComponent(t.id)}/${t.variant}`;
    const url = new URL(path, this.config.baseUrl);
    url.search = new URLSearchParams({ v: String(t.version), exp: String(t.exp), sig }).toString();
    return url.toString();
  }
}
