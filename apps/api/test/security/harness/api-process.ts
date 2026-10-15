import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

/**
 * Thư mục `apps/api` — process API chạy từ đây như `pnpm dev`. `SEC_API_DIR` trỏ sang worktree
 * khác (vd `../TaskFlow_wt/T-016/apps/api`) để dùng suite này làm cổng nghiệm thu branch chưa merge.
 */
const API_DIR = process.env.SEC_API_DIR ?? fileURLToPath(new URL('../../../', import.meta.url));

export interface RunningApi {
  baseUrl: string;
  port: number;
  /** Mọi dòng stdout/stderr của process (log pino JSON) — dùng cho SEC-33. */
  logs(): readonly string[];
  stop(): Promise<void>;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('không lấy được cổng trống'));
      });
    });
  });
}

/**
 * Khởi động `src/main.ts` THẬT (composition root thật, không gọi `createApp` trực tiếp) — test
 * đen bắt được cả lỗi wiring ở main.ts. Chờ `/healthz` trả 200.
 */
export async function startApi(
  env: Record<string, string>,
  { readyTimeoutMs = 30_000 } = {},
): Promise<RunningApi> {
  const port = await freePort();
  const lines: string[] = [];
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: API_DIR,
    // Không kế thừa process.env của máy (tránh .env/secret thật lọt vào) — chỉ PATH/SystemRoot cho Windows.
    env: {
      PATH: process.env.PATH ?? '',
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      ...env,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const collect = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) if (line.trim()) lines.push(line);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  const baseUrl = `http://127.0.0.1:${port}`;

  const deadline = Date.now() + readyTimeoutMs;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`API thoát sớm (code ${child.exitCode}):\n${lines.join('\n')}`);
    }
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) break;
    } catch {
      // chưa listen
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`API không sẵn sàng sau ${readyTimeoutMs}ms:\n${lines.join('\n')}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return {
    baseUrl,
    port,
    logs: () => lines,
    stop: async () => {
      if (child.exitCode === null) child.kill();
      await exited;
    },
  };
}
