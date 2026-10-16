// Smoke lát cắt VPS (D3) — chạy TRONG network của project, đi qua Caddy + TLS (CA nội bộ của Caddy qua
// NODE_EXTRA_CA_CERTS), api.localhost / app.localhost → IP Caddy (--add-host). Node 24: fetch + WebSocket sẵn.
// In một dòng PASS/FAIL cho từng kiểm; exit 1 nếu có FAIL.
const API = 'https://api.localhost';
const APP = 'https://app.localhost';
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`);
};
const j = async (res) => {
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};
const data = (b) => (b && typeof b === 'object' && 'data' in b ? b.data : b);

// 1. healthz / readyz
{
  const h = await fetch(`${API}/healthz`);
  const hb = await j(h);
  check(
    'API /healthz qua Caddy HTTPS',
    h.status === 200,
    `${h.status} ${JSON.stringify(hb).slice(0, 120)}`,
  );
  const r = await fetch(`${API}/readyz`);
  const rb = await j(r);
  check(
    'API /readyz (db + valkey)',
    r.status === 200 && JSON.stringify(rb).includes('"db":"ok"'),
    `${r.status} ${JSON.stringify(rb).slice(0, 160)}`,
  );
  const w = await fetch(`${APP}/api/healthz`);
  check('web /api/healthz qua Caddy HTTPS', w.status === 200, String(w.status));
}

// 2. Header bảo mật (qua Caddy)
{
  const a = await fetch(`${API}/healthz`);
  const hsts = a.headers.get('strict-transport-security');
  check('API: HSTS', !!hsts, hsts ?? 'thiếu');
  check(
    'API: X-Content-Type-Options nosniff',
    a.headers.get('x-content-type-options') === 'nosniff',
  );
  check('API: không lộ X-Powered-By', !a.headers.has('x-powered-by'));
  check(
    'API: Cache-Control no-store trên /auth',
    (await fetch(`${API}/api/v1/auth/me`)).headers.get('cache-control')?.includes('no-store') ??
      false,
  );
  const p = await fetch(`${APP}/login`);
  const csp = p.headers.get('content-security-policy') ?? '';
  check('web /login 200', p.status === 200, String(p.status));
  check(
    'web: CSP có nonce, không unsafe-inline cho script',
    /script-src[^;]*'nonce-/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp),
    csp.slice(0, 140),
  );
  check(
    'web: HSTS',
    p.headers.has('strict-transport-security'),
    p.headers.get('strict-transport-security') ?? 'thiếu',
  );
  check(
    'web: X-Frame-Options/frame-ancestors',
    p.headers.has('x-frame-options') || /frame-ancestors/.test(csp),
  );
  const http = await fetch('http://api.localhost/healthz', { redirect: 'manual' });
  check(
    'HTTP → HTTPS redirect',
    [301, 308].includes(http.status),
    `${http.status} ${http.headers.get('location')}`,
  );
}

// 3. Đăng ký / đăng nhập / refresh
const email = `slice-${Date.now()}@example.test`;
// Mật khẩu sinh ngẫu nhiên mỗi lần (không viết cứng — gitleaks; ≥ 12 ký tự, không chứa email — PasswordPolicy).
const password = `slice-${crypto.randomUUID()}`;
let token;
let wsId;
let cookie;
{
  const reg = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP },
    body: JSON.stringify({ email, password, fullName: 'Slice Smoke' }),
  });
  const rb = data(await j(reg));
  check('đăng ký 201', reg.status === 201, String(reg.status));
  wsId = rb?.defaultWorkspaceId;
  const login = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP },
    body: JSON.stringify({ email, password }),
  });
  const lb = data(await j(login));
  token = lb?.accessToken;
  const setCookie = login.headers.get('set-cookie') ?? '';
  cookie = setCookie.split(';')[0];
  check('đăng nhập 200 + accessToken', login.status === 200 && !!token, String(login.status));
  check(
    'cookie refresh __Host-tf_rt; Secure; HttpOnly; SameSite=Strict; Path=/; không Domain',
    /^__Host-tf_rt=/.test(setCookie) &&
      /;\s*Secure/i.test(setCookie) &&
      /HttpOnly/i.test(setCookie) &&
      /SameSite=Strict/i.test(setCookie) &&
      /Path=\//.test(setCookie) &&
      !/Domain=/i.test(setCookie),
    setCookie.replace(/=[^;]+/, '=<ẩn>').slice(0, 160),
  );
  // Như web client thật (shared/api/http.ts, T-029 H2): POST không body vẫn gửi Content-Type JSON + {} — thiếu ⇒ 415.
  const ref = await fetch(`${API}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { Origin: APP, Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('refresh 200 (Origin hợp lệ, cookie)', ref.status === 200, String(ref.status));
  const nc = (ref.headers.get('set-cookie') ?? '').split(';')[0];
  if (nc) cookie = nc;
  const bad = await fetch(`${API}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('refresh Origin lạ ⇒ 403', bad.status === 403, String(bad.status));
}

// 4. project + 2 task + realtime 1 event khi move
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: APP };
const pj = await fetch(`${API}/api/v1/workspaces/${wsId}/projects`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: 'Slice smoke', keyPrefix: 'SLC' }),
});
const projectId = data(await j(pj))?.id;
check('tạo project 201', pj.status === 201, String(pj.status));
const tasksUrl = `${API}/api/v1/workspaces/${wsId}/projects/${projectId}/tasks`;
const mk = async (title) =>
  data(
    await j(
      await fetch(tasksUrl, { method: 'POST', headers: auth, body: JSON.stringify({ title }) }),
    ),
  );
const t1 = await mk('task một');
const t2 = await mk('task hai');
check('tạo 2 task', !!t1?.id && !!t2?.id);

const event = await new Promise((resolve) => {
  const timer = setTimeout(
    () => resolve({ ok: false, why: 'hết 15 s không nhận task:moved' }),
    15_000,
  );
  const ws = new WebSocket(`wss://api.localhost/socket.io/?EIO=4&transport=websocket`, {
    headers: { Origin: APP },
  });
  ws.onerror = (e) => resolve({ ok: false, why: `ws error ${e?.message ?? ''}` });
  ws.onmessage = async ({ data: m }) => {
    const s = String(m);
    if (s.startsWith('0'))
      return ws.send(`40${JSON.stringify({ token, clientId: 'slice-listener-0001' })}`);
    if (s === '2') return ws.send('3');
    if (s.startsWith('40'))
      return ws.send(`421${JSON.stringify(['project:join', { workspaceId: wsId, projectId }])}`);
    if (s.startsWith('431')) {
      // đã vào phòng ⇒ move qua HTTP (không clientId ⇒ listener phải nhận)
      const mv = await fetch(`${tasksUrl}/${t1.id}/move`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ expectedVersion: t1.version, status: 'IN_PROGRESS', afterId: null }),
      });
      check('move task 200', mv.status === 200, String(mv.status));
      return undefined;
    }
    if (s.startsWith('42')) {
      const [type, payload] = JSON.parse(s.slice(2));
      if (type === 'task:moved') {
        clearTimeout(timer);
        ws.close();
        resolve({
          ok: payload?.task?.id === t1.id || JSON.stringify(payload).includes(t1.id),
          why: JSON.stringify(payload).slice(0, 120),
        });
      }
    }
    if (s.startsWith('44')) resolve({ ok: false, why: `connect_error ${s}` });
    return undefined;
  };
});
check('realtime: nhận 1 event task:moved qua wss (Caddy)', event.ok, event.why);

const failed = results.filter((r) => !r.ok).length;
console.log(`\nTỔNG: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
