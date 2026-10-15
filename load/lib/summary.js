// Tóm tắt k6 → stdout + JSON + Markdown (T-027). Không dùng thư viện từ xa (jslib) — chạy offline được.
const NFR = { read: 150, write: 300 };
const fmt = (v) => (typeof v === 'number' ? v.toFixed(1) : '—');

function metric(data, key) {
  return data.metrics[key]?.values;
}

/** Bậc đầu tiên mà P95 đọc/ghi vượt NFR hoặc tỉ lệ lỗi > 1% ⇒ điểm gãy. */
function stageTable(data, stages) {
  const rows = [];
  let breaking = null;
  for (const rps of stages) {
    const read = metric(data, `http_req_duration{kind:read,stage:${rps}}`);
    const write = metric(data, `http_req_duration{kind:write,stage:${rps}}`);
    const reqs = metric(data, `http_reqs{stage:${rps}}`);
    const failed = metric(data, `http_req_failed{stage:${rps}}`);
    if (!reqs || !reqs.count) continue;
    const over =
      (read && read['p(95)'] > NFR.read) ||
      (write && write['p(95)'] > NFR.write) ||
      (failed && failed.rate > 0.01);
    if (over && breaking === null) breaking = rps;
    rows.push({
      rps,
      requests: reqs.count,
      readP95: read?.['p(95)'],
      readP99: read?.['p(99)'],
      writeP95: write?.['p(95)'],
      writeP99: write?.['p(99)'],
      failedRate: failed?.rate,
      over,
    });
  }
  return { rows, breaking };
}

function endpointTable(data) {
  return Object.keys(data.metrics)
    .filter((k) => k.startsWith('http_req_duration{name:'))
    .map((k) => ({
      endpoint: k.slice('http_req_duration{name:'.length, -1),
      ...data.metrics[k].values,
    }))
    .sort((a, b) => b['p(95)'] - a['p(95)']);
}

export function summarize(data, { scenario, stages = [], outDir, extra = '' }) {
  const { rows, breaking } = stageTable(data, stages);
  const endpoints = endpointTable(data);
  const conflicts = metric(data, 'version_conflicts')?.count ?? 0;
  const limited = metric(data, 'rate_limited')?.count ?? 0;
  const lines = [
    `# k6 — ${scenario} (${new Date().toISOString()})`,
    '',
    rows.length
      ? `**Điểm gãy:** ${breaking === null ? `không vượt NFR tới ${stages[stages.length - 1]} RPS` : `${breaking} RPS (bậc đầu tiên P95 vượt NFR hoặc lỗi > 1%)`}`
      : '',
    '',
  ];
  if (rows.length) {
    lines.push(
      '| RPS mục tiêu | Request | Đọc P95 | Đọc P99 | Ghi P95 | Ghi P99 | Lỗi | Vượt NFR |',
      '|---|---|---|---|---|---|---|---|',
      ...rows.map(
        (r) =>
          `| ${r.rps} | ${r.requests} | ${fmt(r.readP95)} | ${fmt(r.readP99)} | ${fmt(r.writeP95)} | ${fmt(r.writeP99)} | ${fmt((r.failedRate ?? 0) * 100)}% | ${r.over ? '❌' : '✅'} |`,
      ),
      '',
    );
  }
  if (endpoints.length) {
    lines.push(
      '| Endpoint | P50 | P95 | P99 | Max | (ms) |',
      '|---|---|---|---|---|---|',
      ...endpoints.map(
        (e) =>
          `| ${e.endpoint} | ${fmt(e.med)} | ${fmt(e['p(95)'])} | ${fmt(e['p(99)'])} | ${fmt(e.max)} | |`,
      ),
      '',
    );
  }
  lines.push(
    `409 VERSION_CONFLICT (tranh chấp, không tính lỗi): ${conflicts} · 429 RATE_LIMITED: ${limited}`,
    '',
  );
  if (extra) lines.push(extra, '');
  const md = lines.join('\n');
  return {
    stdout: `${md}\n`,
    [`${outDir}/${scenario}-summary.json`]: JSON.stringify(
      { breakingRps: breaking, stages: rows, endpoints, raw: data },
      null,
      2,
    ),
    [`${outDir}/${scenario}-summary.md`]: md,
  };
}
