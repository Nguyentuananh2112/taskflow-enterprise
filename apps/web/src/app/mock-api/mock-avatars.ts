// Ảnh đại diện của mock API (avatar-chat.md ADR-141/142). Server thật mã hóa lại bằng sharp (WebP 256 + 64);
// mock giữ NGUYÊN byte web gửi (JPEG 512 đã cắt) cho cả hai biến thể — đủ để hiển thị và test luồng.

export type AvatarVariant = '64' | '256';
type Stored = { version: number; bytes: Uint8Array; type: string };

/** Khung URL avatar 24 giờ (ADR-141: URL sống 24–48 giờ). */
const BUCKET_MS = 24 * 3_600_000;

export type AvatarChange = Readonly<{ userId: string; avatarUrl: string | null }>;

export class MockAvatars {
  private readonly store = new Map<string, Stored>();
  /** version tăng đơn điệu theo user, kể cả sau khi gỡ (như `avatar_version` + 1). */
  private readonly lastVersion = new Map<string, number>();
  private readonly listeners = new Set<(change: AvatarChange) => void>();

  /** `baseUrl` = API_URL (gồm `/api/v1`) — URL ảnh tuyệt đối như server thật. */
  constructor(
    private readonly baseUrl: string,
    private readonly now: () => number,
  ) {}

  /** URL "ký" giả: `sig=mock` — mock chỉ kiểm version + hạn (server thật kiểm HMAC trước). */
  urlOf(userId: string, variant: AvatarVariant): string | null {
    const stored = this.store.get(userId);
    if (!stored) return null;
    const exp = Math.ceil((this.now() + BUCKET_MS) / BUCKET_MS) * (BUCKET_MS / 1000);
    return `${this.baseUrl}/media/avatars/${userId}/${variant}?v=${stored.version}&exp=${exp}&sig=mock`;
  }

  /** Hai trường của `UserDto` (64 cho chỗ nhỏ, 256 cho /account). */
  fieldsOf(userId: string): { avatarUrl: string | null; avatarUrlLarge: string | null } {
    return { avatarUrl: this.urlOf(userId, '64'), avatarUrlLarge: this.urlOf(userId, '256') };
  }

  set(userId: string, bytes: Uint8Array, type: string): void {
    const version = (this.lastVersion.get(userId) ?? 0) + 1;
    this.lastVersion.set(userId, version);
    this.store.set(userId, { version, bytes, type });
    this.emit(userId);
  }

  /** `true` nếu có ảnh để gỡ. */
  remove(userId: string): boolean {
    const had = this.store.delete(userId);
    if (had) this.emit(userId);
    return had;
  }

  /** Như `/media`: kiểm version còn đúng + chưa hết hạn mỗi lần (ADR-141 B M4). */
  read(userId: string, version: number, exp: number): Stored | undefined {
    const stored = this.store.get(userId);
    if (!stored || stored.version !== version || exp * 1000 < this.now()) return undefined;
    return stored;
  }

  /** `user:avatar-changed` (ADR-142) — socket giả của test nối vào đây. */
  onChange(listener: (change: AvatarChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(userId: string): void {
    const change = { userId, avatarUrl: this.urlOf(userId, '64') };
    this.listeners.forEach((listener) => listener(change));
  }
}
