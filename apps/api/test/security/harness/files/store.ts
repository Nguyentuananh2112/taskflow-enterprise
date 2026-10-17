import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

/**
 * Kho tệp tạm mỗi file suite (test-spec-chat §1.3). TL chốt: tầng S được ĐỌC cây thư mục kho (quan sát hạ tầng như
 * `api.logs()`), không đọc DB. `deleteBlob` chỉ để mô phỏng mất ổ (SEC-CH-31) — khóa lấy từ cây thư mục.
 */
export interface StoreEntry {
  /** Đường dẫn tương đối, dấu `/`. */
  path: string;
  size: number;
}

export interface TempFileStore {
  readonly dir: string;
  /**
   * Thư mục gốc RIÊNG chứa kho (`<root>/w/w/store`) — `snapshotOutside` chỉ duyệt thư mục này. KHÔNG duyệt cha của
   * kho trong %TEMP%: %TEMP% có thể chứa cả worktree + node_modules ⇒ duyệt đồng bộ chặn event loop nhiều phút (lượt
   * chat-upload-limits 18/10 treo, timeout vitest không chạy được).
   */
  readonly root: string;
  tree(): StoreEntry[];
  /** Tệp dưới `tmp/`. */
  tmpFiles(): StoreEntry[];
  /** Tệp không thuộc `tmp/`. */
  blobs(): StoreEntry[];
  deleteBlob(path: string): void;
  cleanup(): void;
}

function walk(root: string, at: string, out: StoreEntry[]): void {
  let names: string[];
  try {
    names = readdirSync(at);
  } catch {
    return; // thư mục vừa bị xóa giữa chừng (sweep / rename) — bỏ qua
  }
  for (const name of names) {
    const full = join(at, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(root, full, out);
    else out.push({ path: relative(root, full).split(sep).join('/'), size: st.size });
  }
}

export function createTempFileStore(prefix = 'tf-sec-files-'): TempFileStore {
  const root = mkdtempSync(join(tmpdir(), prefix));
  // Hai tầng đệm: tên tệp kiểu `../../x` (SEC-CH-09) nếu bị ghép thẳng vào đường dẫn sẽ rơi vào `root/…`, vẫn thấy được.
  const dir = join(root, 'w', 'w', 'store');
  mkdirSync(dir, { recursive: true });
  const tree = () => {
    const out: StoreEntry[] = [];
    walk(dir, dir, out);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  };
  return {
    dir,
    root,
    tree,
    tmpFiles: () => tree().filter((e) => e.path.startsWith('tmp/')),
    blobs: () => tree().filter((e) => !e.path.startsWith('tmp/')),
    deleteBlob(path) {
      if (path.includes('..')) throw new Error(`deleteBlob: đường dẫn lạ ${path}`);
      unlinkSync(join(dir, ...path.split('/')));
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Chụp cây `store.root` (ngoài thư mục kho) — so trước / sau để biết có ghi ra ngoài kho không (SEC-CH-09). Chỉ trong
 * thư mục gốc riêng của suite ⇒ nhỏ, không chặn event loop.
 */
export function snapshotOutside(store: TempFileStore): () => string[] {
  const own = relative(store.root, store.dir).split(sep).join('/');
  const list = () => {
    const out: StoreEntry[] = [];
    walk(store.root, store.root, out);
    return new Set(out.map((e) => e.path).filter((p) => !p.startsWith(`${own}/`)));
  };
  const before = list();
  return () => [...list()].filter((p) => !before.has(p));
}

/** Poll tới khi không còn tệp trong `tmp/` (mặc định ≤ 2 s) — trả danh sách còn sót nếu hết giờ. */
export async function waitNoTmp(store: TempFileStore, withinMs = 2_000): Promise<StoreEntry[]> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const left = store.tmpFiles();
    if (left.length === 0 || Date.now() > deadline) return left;
    await new Promise((r) => setTimeout(r, 100));
  }
}
