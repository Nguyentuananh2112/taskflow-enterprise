import { spawnSync } from 'node:child_process';

import { createClient } from 'redis';

import { freePort } from './api-process';

/** Cùng image (đã pin digest) với compose `taskflow` — có sẵn trên máy dev/CI, không kéo mạng. */
const IMAGE = process.env.SEC_VALKEY_IMAGE ?? 'valkey/valkey:9.1.2';

function docker(args: string[]): string {
  const res = spawnSync('docker', args, { encoding: 'utf8', timeout: 60_000 });
  if (res.status !== 0) {
    const why = res.error ? res.error.message : `exit ${String(res.status)}`;
    throw new Error(`docker ${args.join(' ')} thất bại (${why}): ${res.stderr}`);
  }
  return res.stdout.trim();
}

async function waitReady(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = createClient({
      url,
      socket: { connectTimeout: 1_000, reconnectStrategy: false },
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.ping();
      await client.close();
      return;
    } catch (err) {
      if (Date.now() > deadline)
        throw new Error(`Valkey tạm ${url} không sẵn sàng`, { cause: err });
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export interface TempValkey {
  readonly url: string;
  /** Giết ngay (SIGKILL) — mô phỏng Valkey chết giữa chừng. */
  kill(): void;
  /** Bật lại container (dữ liệu trống: tắt RDB/AOF) và chờ PING. */
  restart(): Promise<void>;
  remove(): void;
}

/**
 * Container Valkey RIÊNG cho kịch bản Valkey sự cố (SEC-24b) — TEAM.md: container tạm cổng khác được
 * phép, tự dọn khi xong; không bao giờ đụng Valkey compose dùng chung. Không lưu dữ liệu ⇒ bật lại là
 * cache trống, lần đọc kế tiếp buộc phải lấy từ DB.
 */
export async function startTempValkey(): Promise<TempValkey> {
  const port = await freePort();
  const name = `taskflow-sec-valkey-${String(process.pid)}-${String(port)}`;
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--label',
    'taskflow.security-suite=temp',
    '-p',
    `127.0.0.1:${String(port)}:6379`,
    IMAGE,
    'valkey-server',
    '--save',
    '',
    '--appendonly',
    'no',
  ]);
  const url = `redis://127.0.0.1:${String(port)}/0`;
  const remove = () => {
    spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', timeout: 60_000 });
  };
  try {
    await waitReady(url);
  } catch (err) {
    remove();
    throw err;
  }
  return {
    url,
    kill: () => {
      docker(['kill', name]);
    },
    restart: async () => {
      docker(['start', name]);
      await waitReady(url);
    },
    remove,
  };
}
