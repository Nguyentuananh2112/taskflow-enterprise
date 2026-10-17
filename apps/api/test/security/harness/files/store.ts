import { mkdtempSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
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
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const tree = () => {
    const out: StoreEntry[] = [];
    walk(dir, dir, out);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  };
  return {
    dir,
    tree,
    tmpFiles: () => tree().filter((e) => e.path.startsWith('tmp/')),
    blobs: () => tree().filter((e) => !e.path.startsWith('tmp/')),
    deleteBlob(path) {
      if (path.includes('..')) throw new Error(`deleteBlob: đường dẫn lạ ${path}`);
      unlinkSync(join(dir, ...path.split('/')));
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Chụp cây thư mục CHA của kho — so trước / sau để biết có ghi ra ngoài kho không (SEC-CH-09). */
export function snapshotOutside(store: TempFileStore): () => string[] {
  const parent = join(store.dir, '..');
  const own = relative(parent, store.dir);
  const list = () => {
    const out: StoreEntry[] = [];
    walk(parent, parent, out);
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
