// T-044 — đo khởi động board (thẻ đầu) trên bản build PROD (standalone), Chromium headless, CPU 4× (CDP).
// Gốc: perf-mount.mjs của E (perf-board-mount-result.md) + mốc pha (refresh → me → query) + byte JS.
// CHẠY RIÊNG, KHÔNG vào CI (ms phụ thuộc máy). Là việc NẶNG: xin lượt máy của Tech Lead.
//
//   node e2e/perf/startup.mjs compare <dirA> <dirB> [--sig "chuỗi chỉ có ở B"] [--rounds 3] [--tasks 10]
//   node e2e/perf/startup.mjs once <dir> [--tasks 10]
//
// <dir> = GỐC một bản checkout đã `pnpm --filter @taskflow/web build` (apps/web/.next/standalone có sẵn). Mỗi bản ở
// thư mục RIÊNG, build thẳng tại chỗ (standalone có liên kết tuyệt đối — không mv). Mỗi lượt: kiểm dấu hiệu bản build
// (số chunk chứa `--sig`: A phải 0, B phải ≥ 1 — sai ⇒ dừng), CPU nền < 25 % (không thì chờ 20 s), khởi động server,
// đo 1 lần, tắt server và chờ thoát hẳn. Thứ tự xen kẽ A,B,B,A,A,B,… để hai bản cùng chịu nhiễu của máy.
/* global window, document, MutationObserver -- callback của page.evaluate / addInitScript chạy TRONG trình duyệt */
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const PORT = Number(process.env.PERF_PORT ?? 3021); // KHÔNG dùng 3001 / 4000 (của người dùng)
const BASE = `http://localhost:${PORT}`;
const API = `${BASE}/mock-api/v1`;
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const TASKS = Number(opt('tasks', '10'));
const OUT = resolve(opt('out', 'e2e/test-results/perf-startup.jsonl'));
mkdirSync(resolve(OUT, '..'), { recursive: true });

// ---------------------------------------------------------------- máy + bản build

/** % CPU toàn máy (Windows: Win32_Processor.LoadPercentage; nơi khác: loadavg / số lõi). */
function cpuLoad() {
  if (process.platform === 'win32') {
    const out = execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average',
    ]).toString();
    return Math.round(Number(out.trim()));
  }
  return Math.round(
    (Number(execFileSync('sh', ['-c', 'cat /proc/loadavg']).toString().split(' ')[0]) * 100) / 8,
  );
}

async function waitQuietCpu() {
  for (let i = 0; i < 6; i += 1) {
    const load = cpuLoad();
    if (load < 25) return load;
    console.error(`  CPU nền ${load} % ≥ 25 % — chờ 20 s`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
  throw new Error('Máy không yên (CPU ≥ 25 % sau 2 phút) — dừng, không lấy số');
}

const webOf = (root) => join(resolve(root), 'apps', 'web');

/** Số file chunk của bản build chứa `sig` (dấu hiệu bản build — perf-board-mount-result.md). */
function signatureCount(root, sig) {
  if (!sig) return null;
  const dir = join(webOf(root), '.next', 'static', 'chunks');
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && readFileSync(p, 'utf8').includes(sig)) n += 1;
    }
  };
  walk(dir);
  return n;
}

/** Như e2e/support/start-web.mjs: copy static/public vào standalone rồi chạy server.js của ĐÚNG thư mục. */
async function startServer(root) {
  const web = webOf(root);
  const appDir = join(web, '.next', 'standalone', 'apps', 'web');
  if (!existsSync(join(appDir, 'server.js')))
    throw new Error(`thiếu ${appDir}/server.js — build trước`);
  cpSync(join(web, '.next', 'static'), join(appDir, '.next', 'static'), { recursive: true });
  if (existsSync(join(web, 'public')))
    cpSync(join(web, 'public'), join(appDir, 'public'), { recursive: true });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: appDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      APP_ENV: 'local',
      APP_MOCK_API: '1', // mock API cùng origin (mock-flag.ts) — không cần API thật / socket
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (b) => (err += b.toString()));
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${BASE}/login`)).ok) return child;
    } catch {
      /* chưa lên */
    }
    if (child.exitCode !== null) throw new Error(`server thoát sớm: ${err.slice(-500)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('server không lên sau 60 s');
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill();
  await exited;
  // Windows còn giữ cổng / file một lúc sau khi tiến trình thoát.
  await new Promise((r) => setTimeout(r, 1500));
}

// ---------------------------------------------------------------- đo một lượt

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}`);
  return (await res.json()).data;
}

/** Mốc (ms từ lúc điều hướng) của request đầu tiên khớp `re`: bắt đầu gửi / nhận xong. */
const PHASES = {
  refresh: '/auth/refresh',
  me: '/auth/me',
  board: '/tasks',
  today: '/attendance/me/today',
  unread: '/notifications/unread-count',
};

async function measureOnce(browser) {
  const email = `startup-${Date.now().toString(36)}@e2e.example`;
  const password = 'do-khoi-dong-board';
  const reg = await api('POST', '/auth/register', null, {
    email,
    password,
    fullName: 'Startup Check',
  });
  const ws = reg.defaultWorkspaceId;
  const list = await api('GET', `/workspaces/${ws}/projects`, reg.accessToken);
  const pid = (Array.isArray(list) ? list : list.items)[0].id;
  for (let i = 0; i < TASKS; i += 1) {
    await api('POST', `/workspaces/${ws}/projects/${pid}/tasks`, reg.accessToken, {
      title: `Task số ${i}`,
    });
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(120_000);
  const cdp = await page.context().newCDPSession(page);
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: /đăng nhập/i }).click();
  await page.waitForURL(/\/w(\/|$)/);
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => window.__long.push(e.duration)),
    ).observe({
      type: 'longtask',
      buffered: true,
    });
    window.__first = 0;
    new MutationObserver(() => {
      if (!window.__first && document.querySelector('article[data-task-id]'))
        window.__first = performance.now();
    }).observe(document, { childList: true, subtree: true });
  });
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const metric = (m, name) => m.metrics.find((x) => x.name === name)?.value ?? 0;
  const before = await cdp.send('Performance.getMetrics');
  // Điều hướng đầy đủ (như mở tab / F5): khôi phục phiên qua cookie refresh → me → query của route.
  await page.goto(`${BASE}/w/${ws}/p/${pid}`);
  await page
    .locator('article[data-task-id]')
    .nth(TASKS - 1)
    .waitFor();
  await page.waitForTimeout(1500);
  const after = await cdp.send('Performance.getMetrics');
  const r = await page.evaluate((phases) => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const at = {};
    for (const [k, needle] of Object.entries(phases)) {
      const e = res.find((x) => new URL(x.name).pathname.includes(needle));
      at[k] = e ? [Math.round(e.startTime), Math.round(e.responseEnd)] : null;
    }
    const js = res.filter((x) => x.initiatorType === 'script' || x.name.endsWith('.js'));
    return {
      first: window.__first,
      long: window.__long,
      responseStart: Math.round(nav.responseStart),
      domInteractive: Math.round(nav.domInteractive),
      at,
      jsTransferKB: Math.round(js.reduce((s, x) => s + x.transferSize, 0) / 1024),
      jsDecodedKB: Math.round(js.reduce((s, x) => s + x.decodedBodySize, 0) / 1024),
      jsFiles: js.length,
    };
  }, PHASES);
  await page.close();
  const d = (name) => Math.round((metric(after, name) - metric(before, name)) * 1000);
  return {
    firstCard: Math.round(r.first),
    longMax: Math.round(Math.max(0, ...r.long)),
    longSum: Math.round(r.long.reduce((s, x) => s + x, 0)),
    script: d('ScriptDuration'),
    task: d('TaskDuration'),
    responseStart: r.responseStart,
    domInteractive: r.domInteractive,
    ...Object.fromEntries(Object.entries(r.at).map(([k, v]) => [k, v ? v.join('→') : '-'])),
    jsTransferKB: r.jsTransferKB,
    jsDecodedKB: r.jsDecodedKB,
    jsFiles: r.jsFiles,
  };
}

async function lap(label, root, sig, expectSig) {
  const sigCount = signatureCount(root, sig);
  if (sig && (expectSig === 0 ? sigCount !== 0 : sigCount < 1)) {
    throw new Error(
      `DẤU HIỆU SAI ở ${label} (${root}): ${sigCount} chunk chứa dấu hiệu — dừng toàn bộ`,
    );
  }
  const cpu = await waitQuietCpu();
  const server = await startServer(root);
  const browser = await chromium.launch();
  try {
    const m = await measureOnce(browser);
    const row = { at: new Date().toISOString(), label, sig: sigCount, cpu, tasks: TASKS, ...m };
    appendFileSync(OUT, `${JSON.stringify(row)}\n`);
    console.log(JSON.stringify(row));
    return row;
  } finally {
    await browser.close();
    await stopServer(server);
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const [mode, a, b] = args;
if (mode === 'once') {
  await lap('once', a, null, null);
} else if (mode === 'compare') {
  const sig = opt('sig', null);
  const rounds = Number(opt('rounds', '3'));
  const order = [];
  for (let i = 0; i < rounds; i += 1) order.push(...(i % 2 === 0 ? ['A', 'B'] : ['B', 'A']));
  const rows = { A: [], B: [] };
  for (const v of order) rows[v].push(await lap(v, v === 'A' ? a : b, sig, v === 'A' ? 0 : 1));
  for (const k of ['firstCard', 'longMax', 'script', 'jsTransferKB']) {
    console.log(
      `${k}: A ${median(rows.A.map((x) => x[k]))} / B ${median(rows.B.map((x) => x[k]))} (trung vị)`,
    );
  }
} else {
  console.error('dùng: compare <dirA> <dirB> [--sig s] [--rounds n] [--tasks n] | once <dir>');
  process.exit(2);
}
