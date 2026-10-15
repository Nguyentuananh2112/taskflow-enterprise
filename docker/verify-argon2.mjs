// Kiểm chứng @node-rs/argon2 chạy trong image runtime của api (ADR-065, devops.md §3.2).
// Chạy bằng stdin để module được resolve từ WORKDIR của image (node_modules do `pnpm deploy` tạo):
//   docker run --rm -i taskflow-api:<tag> node --input-type=module - < docker/verify-argon2.mjs
// Thoát 0 khi mọi kiểm tra đạt, 1 khi có lỗi. In JSON một dòng để dán vào báo cáo / log CI.
import { arch, platform, version } from 'node:process';
import { performance } from 'node:perf_hooks';

import { Algorithm, hash, verify } from '@node-rs/argon2';

// Tham số OWASP chốt ở ADR-065 — phải trùng với adapter băm mật khẩu của T-013.
const PARAMS = { algorithm: Algorithm.Argon2id, memoryCost: 47_104, timeCost: 1, parallelism: 1 };
const RUNS = 5;

const password = 'mật-khẩu-thử-nghiệm-đủ-dài';
// 72 byte giống nhau + hậu tố khác nhau: bcrypt coi là trùng, argon2 phải phân biệt (stack-versions §9).
const long72 = 'a'.repeat(72);

const timings = [];
let digest = '';
for (let i = 0; i < RUNS; i += 1) {
  const start = performance.now();
  digest = await hash(password, PARAMS);
  timings.push(performance.now() - start);
}

const checks = {
  phcPrefix: digest.startsWith('$argon2id$v=19$m=47104,t=1,p=1$'),
  verifyCorrect: await verify(digest, password),
  rejectWrong: !(await verify(digest, `${password}x`)),
  noTruncateAt72Bytes: !(await verify(await hash(`${long72}A`, PARAMS), `${long72}B`)),
};

const sorted = [...timings].sort((a, b) => a - b);
const result = {
  ok: Object.values(checks).every(Boolean),
  node: version,
  platform: `${platform}-${arch}`,
  checks,
  hashMs: {
    min: Number(sorted[0].toFixed(1)),
    median: Number(sorted[Math.floor(RUNS / 2)].toFixed(1)),
    max: Number(sorted[RUNS - 1].toFixed(1)),
  },
};

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
