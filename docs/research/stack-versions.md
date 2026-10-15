# Stack versions — TaskFlow Enterprise (T-001)

> Tác giả: Engineer A (`taskflow-enterprise-50`) · Ngày kiểm tra: **2026-10-15** · Trạng thái: **Chờ Tech Lead duyệt**
> Phương pháp: `npm view <pkg> dist-tags/peerDependencies/engines` (registry.npmjs.org), `nodejs.org/dist/index.json`, Docker Hub API, docs/changelog chính thức. Các điểm có nhãn **[ĐÃ CHẠY]** được kiểm chứng bằng cách cài vào thư mục tạm ngoài repo và chạy thật (Node 24.18, Windows 11). **UNVERIFIED** = chưa xác minh được từ nguồn chính thức.
> Ký hiệu: ⚠️ = ADR hiện tại sai/cần đổi · 🟡 = cần Tech Lead quyết.

## 0. Tóm tắt điều Tech Lead cần biết

| # | Phát hiện | Hệ quả |
|---|---|---|
| 1 | ⚠️ **TypeScript `latest` = 7.0.2** (bản native Go) nhưng **7.0 không có programmatic API** → typescript-eslint (peer `typescript <6.1.0`) và dependency-cruiser (`<7.0.0`) không chạy được. | Pin **TypeScript 6.0.3**. ADR-002 ghi "TS 5.x" → sửa thành 6.0. |
| 2 | ⚠️ **`prisma` dist-tag `latest` = 8.0.0-rc.22** (RC, CLI hoàn toàn khác: không còn lệnh `migrate`/`generate`/`validate`). `@prisma/client` latest vẫn 7.10.0. **[ĐÃ CHẠY]** `npx prisma` khi chưa cài local đã kéo về 8.0.0-rc.22. | Pin **chính xác** `prisma@7.10.0` + `@prisma/client@7.10.0`. Cấm `npx prisma` không pin trong Dockerfile/CI — chỉ dùng `pnpm exec prisma`. Đọc docs ở `/docs/orm/v7/`. |
| 3 | ESLint 10 ra từ 02/2026, **ESLint 9 EOL 2026-08-06**. Nhưng `eslint-config-next@16.4.1` kéo `eslint-plugin-react`/`import`/`jsx-a11y` chỉ hỗ trợ tới ESLint 9. | 🟡 Đề xuất ESLint 10 + tự ghép plugin (bỏ `eslint-config-next`) — xem §5. |
| 4 | Next 16: `middleware.ts` → `proxy.ts` (chỉ nodejs), Turbopack mặc định, `next lint` bị xóa, Cache Components sẽ thành mặc định ở Next 17. | Không ảnh hưởng ADR; ghi chú cho Phase 4. |
| 5 | Tailwind 4: cấu hình CSS-first, **không còn `tailwind.config.ts`** (chỉ nạp qua `@config`). | Không tạo file config JS. |
| 6 | Prisma 7.10 **[ĐÃ CHẠY]**: `uuid(7)` + `@db.Uuid` hợp lệ; **partial unique index khai báo native được** (preview `partialIndexes`); collation cột vẫn phải viết SQL tay. | Trả lời các TODO(T-001) của T-003 — §8. |
| 7 | Password hashing **[ĐÃ CHẠY]**: argon2id (OWASP m=19MiB,t=2,p=1) ≈ 16–26 ms so với bcrypt 12 ≈ 219 ms; argon2 không cắt 72 byte. | **Khuyến nghị argon2id** (`@node-rs/argon2`) — §9, phục vụ ADR-048. |
| 8 | Redis 8 có lựa chọn **AGPLv3**; 7.4–7.8 là RSALv2/SSPL (không OSI). node-redis là client Redis khuyến nghị; ioredis "best-effort". | Redis **8.10** + **node-redis 6**. |
| 9 | PG18 Docker image đổi đường dẫn volume (`/var/lib/postgresql`). | Chọn PostgreSQL **18.6**; ghi chú compose. |

---

## 1. Runtime

| Gói | Pin đề xuất | Nguồn | Lưu ý |
|---|---|---|---|
| Node.js | **24.22.0** (Active LTS "Krypton") | https://nodejs.org/dist/index.json | Node 26.12 chưa vào LTS (dự kiến cuối 10/2026) — không dùng. Vitest 5, dependency-cruiser 18, tsdown đòi Node ≥22. Node 24 ≥24.12 chạy `.ts` native (type stripping, stable). Corepack vẫn có trong Node 24, bị gỡ từ Node 25. |
| pnpm | 🟡 **11.28.2** (dist-tag `latest-11`) | `npm view pnpm dist-tags` · https://pnpm.io/blog/releases/11.0 · https://pnpm.io/blog/releases/12.0 | Registry: `latest` = **12.11.2** (bản viết lại bằng Rust, chưa có trên winget/Scoop/Chocolatey). Đề xuất 11.28.x cho Phase 1 (dòng JS chín muồi, vẫn được vá — `next-11` = 11.28.5), đánh giá lại 12 ở Phase 5. pnpm 11: `minimumReleaseAge` mặc định 1 ngày; **build script bị chặn mặc định → khai báo `allowBuilds`** trong `pnpm-workspace.yaml` (cần cho `@prisma/engines`, `esbuild`, `@tailwindcss/oxide`, `@node-rs/argon2` không cần vì là prebuilt); `.npmrc` chỉ còn registry/auth. Pin qua `"packageManager": "pnpm@11.28.2"`. |
| TypeScript | ⚠️ **6.0.3** (`~6.0.3`) | https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ · https://github.com/typescript-eslint/typescript-eslint/issues/12518 | TS 7.0.2 là `latest` nhưng không có API cho tool (dự kiến API mới ở 7.1). TS 6 đổi mặc định: `strict: true`, `module: esnext`, `target` mới nhất, **`types: []`** (phải khai `"types": ["node"]` ở API), `rootDir` = thư mục tsconfig. Deprecate `baseUrl`, `moduleResolution: node10`. Code sạch trên 6.0 sẽ chạy trên 7.0 → nâng khi typescript-eslint hỗ trợ. Next 16.3+ đã hỗ trợ TS 7. |

## 2. Backend

| Gói | Pin đề xuất | Nguồn | Lưu ý |
|---|---|---|---|
| express | **5.3.0** | https://expressjs.com/en/guide/migrating-5.html · https://github.com/expressjs/express/releases | Promise reject trong handler tự `next(err)` → không cần try/catch (ADR-017 đúng). Route: wildcard phải đặt tên `/*splat` (giá trị là mảng), optional dùng `{/:x}`, không còn ký tự regex. `req.query` là getter (không gán được — validate xong phải lưu vào `res.locals`/thuộc tính riêng), query parser mặc định `simple`. `req.body` = `undefined` nếu không có parser. Bỏ `res.send(status)`, `app.del`, `req.param`. 5.3.0 vá bảo mật qs/body-parser/proxy-addr; `limit` sai thì throw lúc khởi động. |
| @types/express | 5.0.6 | npm | |
| zod | **4.6.7** | https://zod.dev/v4/changelog · https://zod.dev/api | **[ĐÃ CHẠY]** xem §8.4. `error` thay `message`/`required_error`/`errorMap`; `.flatten()`/`.format()` deprecated → `z.flattenError()`/`z.treeifyError()` (ADR-017 đúng). `.strict()`→`z.strictObject`, `.merge`→`.extend`; `z.record` cần 2 tham số. `.default()` giờ short-circuit (muốn hành vi cũ: `.prefault()`). Import `import * as z from "zod"`. |
| prisma / @prisma/client / @prisma/adapter-pg | ⚠️ **7.10.0** (exact, không `^`) | https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7 · https://www.prisma.io/docs/orm/release-status · https://www.prisma.io/docs/guides/v7/deployment/docker | Generator **`prisma-client`** (Rust-free), `output` **bắt buộc** (không sinh vào node_modules). URL DB nằm trong **`prisma.config.ts`**, không trong `schema.prisma`. **Driver adapter bắt buộc**: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. `.env` không tự nạp → `import "dotenv/config"` trong `prisma.config.ts`. Cần ESM. Prisma 8 GA "dự kiến 10/2026"; Prisma 7 được vá 18 tháng sau đó → không nâng trong dự án này trước Phase 5. Chi tiết §8. |
| pg | 8.23.1 (transitive qua adapter-pg) | npm | Driver `pg` **không có connection timeout mặc định** → đặt `connectionTimeoutMillis` khi tạo `PrismaPg`. |
| socket.io / socket.io-client | **4.8.4** | https://socket.io/docs/v4/ | API `io.in(room).socketsLeave/disconnectSockets` mà security.md dùng là API v4, chạy xuyên node khi có adapter. |
| @socket.io/redis-adapter | **8.3.0** | https://socket.io/docs/v4/redis-adapter/ | Hỗ trợ cả node-redis và ioredis. Sharded adapter cần Redis ≥7 + `redis` ≥4.6. Gói cập nhật lần cuối 2024-03 (ổn định, ít thay đổi). |
| Redis client | **redis (node-redis) 6.3.0** — chọn thay ioredis | https://redis.io/docs/latest/develop/clients/nodejs/ · https://github.com/redis/ioredis | redis.io: "node-redis is the recommended client library"; README ioredis: bảo trì "best-effort", dự án mới dùng node-redis. Cả rate-limit-redis và redis-adapter đều hỗ trợ. |
| Password hash | ⚠️🟡 **@node-rs/argon2 2.2.2** (argon2id) thay bcrypt | §9 | Kết luận ở §9. |
| JWT | **jose 6.2.12** — chọn thay jsonwebtoken 9.0.3 | https://github.com/panva/jose | Zero-dep, Web Crypto, typed, Promise. ESM nhưng Node 24 `require(esm)` vẫn chạy. Dùng `new SignJWT(...).setProtectedHeader({ alg: "HS256" })` và `jwtVerify(token, key, { algorithms: ["HS256"], issuer, audience })` — khớp yêu cầu whitelist thuật toán ở security.md §3. jsonwebtoken chỉ callback/CJS, không cập nhật đáng kể. |
| helmet | **8.3.0** | https://github.com/helmetjs/helmet/blob/main/CHANGELOG.md | HSTS mặc định 365 ngày; CSP throw khi keyword không có nháy (`'self'`); 8.3 từ chối `useDefaults:false` mà không có directive. |
| cors | 2.8.6 | npm | Ổn định. |
| cookie-parser | 1.4.7 | npm | Chỉ cần nếu không tự parse; refresh cookie chỉ đọc 1 cookie ở `/api/v1/auth`. |
| express-rate-limit | **8.7.1** | https://express-rate-limit.mintlify.app/reference/changelog | v8 gom IPv6 theo **/56** mặc định (`ipv6Subnet`). keyGenerator tự viết dùng `req.ip` **phải** gọi `ipKeyGenerator(ip)` (không thì cảnh báo validation). Header chuẩn `RateLimit`/`RateLimit-Policy` (khớp security.md §6.3) qua `standardHeaders: "draft-8"`. Có option `retryAfter` từ 8.7. |
| rate-limit-redis | **6.0.1** | https://github.com/express-rate-limit/rate-limit-redis | Peer `express-rate-limit >= 8.6.0`. Với node-redis: `new RedisStore({ sendCommand: (...args) => client.sendCommand(args), prefix: "rl:..." })`. |
| pino / pino-http | **10.4.0 / 11.0.0** | https://github.com/pinojs/pino/releases · https://github.com/pinojs/pino-http/releases | pino 10 chỉ bỏ Node 18; pino-http 11 = cập nhật cho pino 10. `redact` như security.md §7. |
| fractional-indexing | **4.0.0** | https://github.com/rocicorp/fractional-indexing | **[ĐÃ CHẠY]** ESM (`exports: ./src/index.js`), `require()` vẫn được trên Node 24. `generateKeyBetween(a, b)`, `generateNKeysBetween(a, b, n)`; khóa so sánh byte (`"a0" < "a1"`) → cần collation "C" ở DB. |
| dotenv | 18.0.8 | npm | Chỉ cho `prisma.config.ts` & dev; production lấy env từ orchestrator. |

## 3. Frontend

| Gói | Pin đề xuất | Nguồn | Lưu ý |
|---|---|---|---|
| next | **16.4.1** | https://nextjs.org/docs/app/guides/upgrading/version-16 · https://nextjs.org/blog/next-16-4 | Node ≥20.9, TS ≥5.1. **Turbopack mặc định** cho dev+build (custom webpack config → build fail). **`middleware.ts` → `proxy.ts`**, `export function proxy`, chỉ runtime nodejs. Async request API bắt buộc (`await params`, `await cookies()`). `next lint` bị xóa → gọi ESLint CLI. Caching: `cacheComponents: true` + `'use cache'`; `revalidateTag(tag, profile)` cần tham số 2. Mỗi slot parallel route phải có `default.js`. Sau đợt CVE RSC 12/2025 → luôn ở bản 16.x mới nhất. ADR-026 (dashboard render client) không cần proxy/middleware cho auth. Turbopack tự transpile workspace package — **không cần `transpilePackages`** cho `packages/contracts`. |
| react / react-dom | **19.3.1** | npm | Next 16.4 dùng React 19.3. React Compiler (`reactCompiler: true`) stable nhưng tắt mặc định — 🟡 không bật ở Phase 4 trừ khi Tech Lead muốn. |
| tailwindcss / @tailwindcss/postcss / postcss | **4.3.3 / 4.3.3 / 8.5.30** | https://tailwindcss.com/docs/upgrade-guide · https://tailwindcss.com/docs/installation/framework-guides/nextjs | ⚠️ **Không có `tailwind.config.ts`**: cấu hình bằng `@import "tailwindcss";` + `@theme { … }` trong CSS; quét nội dung tự động (`@source` để thêm). `postcss.config.mjs`: `{ plugins: { "@tailwindcss/postcss": {} } }`, không cần autoprefixer. Trình duyệt tối thiểu Safari 16.4 / Chrome 111 / Firefox 128. |
| @tanstack/react-query | **5.104.2** | https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr | `QueryClientProvider` trong `'use client'` provider. Vì ADR-026 (dashboard client-side), không cần `HydrationBoundary`/prefetch phía server. |
| HTTP client | **fetch wrapper tự viết** (không axios) | https://github.com/axios/axios/security/advisories | Đợt 12 advisory axios 2026-09-30 (prototype pollution, header injection, SSRF…); fetch wrapper ~60 dòng đủ cho: access token trong RAM, 401 `TOKEN_EXPIRED` → `POST /auth/refresh` (`credentials: "include"`) **single-flight** (1 promise dùng chung), retry 1 lần. Nếu Tech Lead muốn thư viện: axios ≥1.20.0. |
| Kéo thả | 🟡 **@dnd-kit/react 0.5.0 + @dnd-kit/helpers 0.5.0** (pin exact) | https://dndkit.com/react/quickstart · https://dndkit.com/react/guides/migration | dndkit.com gắn nhãn bản mới là "Latest", `@dnd-kit/core`/`sortable` là "Legacy" (core publish cuối 12/2024). Có guide "multiple sortable lists" (Kanban). Rủi ro: còn 0.x → pin exact. Phương án dự phòng: core 6.3.1 + sortable 10.0.0. |
| socket.io-client | **4.8.4** | https://socket.io/how-to/use-with-nextjs | Chỉ trong client component; `autoConnect: false`, `auth: (cb) => cb({ token })` (callback được gọi lại mỗi lần reconnect → luôn lấy token mới) — khớp security.md §5.1. |

## 4. Testing

| Gói | Pin đề xuất | Nguồn | Lưu ý |
|---|---|---|---|
| vitest + @vitest/coverage-v8 | **5.0.4** (cùng version, exact) | https://vitest.dev/guide/migration | Node ^22.12/^24. ⚠️ **`vite` thành peer bắt buộc** → thêm `vite@8.3.4` devDependency. Monorepo dùng `test.projects` ở root (project con kế thừa root mặc định). `clearMocks: true` mặc định; `vi.mock` trong function → throw; không còn tìm config ở thư mục cha. |
| @playwright/test | **1.64.1** | npm | Next 16 khai peer `@playwright/test ^1.51.1`. Image CI cần glibc (dùng image `mcr.microsoft.com/playwright`), lý do thêm để API/web dùng `-slim` thay alpine. |
| k6 | **v2.3.0** (binary/Docker `grafana/k6:2.3.0`, không phải npm) | https://github.com/grafana/k6/releases | Chạy `.ts` native (strip type). Kiểu: `@types/k6@2.3.0`. Gói npm `k6` chỉ là stub — đừng cài. |
| @testing-library/react / jsdom | 16.3.3 / 30.1.2 | npm | Cho test component FE (Phase 4). |

## 5. Tooling

| Gói | Pin đề xuất | Nguồn | Lưu ý |
|---|---|---|---|
| eslint + @eslint/js | 🟡 **10.12.0 / 10.0.1** | https://eslint.org/docs/latest/use/migrate-to-10.0.0 | Chỉ flat config; tìm config từ thư mục file được lint; `/* eslint-env */` lỗi. ESLint 9 EOL 2026-08-06. |
| typescript-eslint | **8.71.2** | npm (peer `eslint ^8.57‖^9‖^10`, `typescript <6.1.0`) | Lý do chính để giữ TS 6. |
| eslint-plugin-react-hooks | **7.1.1** | https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/README.md | Preset `reactHooks.configs.flat.recommended`; hỗ trợ ESLint 10. |
| @next/eslint-plugin-next | **16.4.1** | npm | Không có peer eslint → dùng được với ESLint 10. |
| eslint-plugin-import-x | **4.17.1** | npm (peer `eslint ^10`) | Thay `eslint-plugin-import` (chưa hỗ trợ 10). |
| eslint-config-prettier | 10.1.8 | npm | |
| globals | 17.13.0 | npm | |
| ~~eslint-config-next~~ | **không dùng** (nếu chọn ESLint 10) | npm: deps `eslint-plugin-react@7.37` (peer ≤`^9.7`), `eslint-plugin-jsx-a11y@6.10.2` (≤`^9`), `eslint-plugin-import@2.32` (≤`^9`) | 🟡 **Phương án A (đề xuất)**: ESLint 10 + ghép tay `typescript-eslint` + `@next/eslint-plugin-next` + `react-hooks` + `import-x` → không phụ thuộc bản EOL; mất `jsx-a11y` (bù bằng Playwright + axe ở Phase 5). **Phương án B**: ESLint 9.39.5 (dist-tag `maintenance`, đã EOL) + `eslint-config-next` đầy đủ. Quy tắc ADR-004 (`max-lines`, `no-restricted-imports`) là core rule → chạy được ở cả 2. |
| dependency-cruiser | **18.6.0** | https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md | Node ^22/^24. Hỗ trợ TS `>=2 <7` (thêm lý do giữ TS 6). Config `.dependency-cruiser.cjs` (repo ESM). |
| prettier | **3.9.10** | npm | 4.0 vẫn alpha. |
| Chạy/build API | **tsx 4.23.15** (dev) + **tsdown 0.23.1** (build prod) | https://github.com/egoist/tsup · https://tsdown.dev/guide/migrate-from-tsup | README tsup: "not actively maintained… consider tsdown". tsdown peer TS ^5‖^6‖^7, Node ≥22.18/24.11. Build: bundle `apps/api` + inline `@taskflow/contracts` (`noExternal`), giữ `@prisma/*`, `pg`, `@node-rs/argon2` external. Typecheck riêng bằng `tsc --noEmit`. |
| turbo | **không dùng** (2.11.8 nếu cần sau) | https://turborepo.dev/docs/core-concepts/internal-packages | Với 2 app + 2 package, `pnpm -r`/`--filter` đủ; cache turbo không giúp được package JIT. (Nhận định của tôi, không phải nguồn.) |

## 6. Hạ tầng (Docker)

| Image | Tag đề xuất | Nguồn | Lưu ý |
|---|---|---|---|
| postgres | **18.6** (dev/CI: `postgres:18.6-alpine` được; prod theo nhà cung cấp) | https://www.postgresql.org/support/versioning/ · https://hub.docker.com/_/postgres | 18 EOL 2030-11-14 (17: 2029-11-08). ⚠️ **Image 18 đổi volume**: mount `/var/lib/postgresql` (PGDATA = `/var/lib/postgresql/18/docker`), không phải `/var/lib/postgresql/data` như ≤17. PG18 có `uuidv7()` native, nhưng Prisma sinh uuid ở client nên không phụ thuộc. |
| redis | **8.10.2** (`redis:8.10.2-alpine` cho dev) | https://redis.io/legal/licenses/ · https://hub.docker.com/_/redis | Giấy phép: ≤7.2 BSD; 7.4–7.8 RSALv2/SSPLv1 (không OSI); **8+ thêm AGPLv3**. Dùng Redis như dịch vụ backend không sửa source → không phát sinh nghĩa vụ AGPL thực tế; nếu pháp chế không chấp nhận AGPL → **Valkey 9.1.2** (BSD — UNVERIFIED, Linux Foundation fork; giao thức tương thích). 🟡 Tech Lead/chủ dự án chọn. |
| node (runtime API) | **node:24.22.0-bookworm-slim** | https://hub.docker.com/_/node | Chọn slim (glibc) thay alpine: Prisma/Playwright/prebuilt native ổn định nhất trên glibc. Alpine cũng chạy được (bcrypt/argon2/@node-rs đều có prebuild musl) nếu cần image nhỏ. Có cả tag `24.22.0-trixie-slim`. |

---

## 7. Đối chiếu với `docs/design/security.md`

| Mục security.md | Gói chốt | Ghi chú |
|---|---|---|
| §3 JWT HS256, whitelist `algorithms` | jose 6.2.12 | `jwtVerify(token, secretKey, { algorithms: ["HS256"] })`; secret = `new TextEncoder().encode(JWT_ACCESS_SECRET)` (≥32 byte). |
| §1 bcrypt cost 12, DUMMY_HASH, "≈250ms" | ⚠️ đề xuất argon2id | Nếu Tech Lead duyệt §9: thay `bcrypt.hash/compare` → `hash/verify` của `@node-rs/argon2`; DUMMY_HASH vẫn áp dụng; thời gian ≈16–30ms. Luật mật khẩu "≤72 byte" (data-and-api.md:369) không còn cần cho thuật toán — 🟡 vẫn nên giữ một giới hạn trên (vd 256 byte) chống DoS. |
| §2.4 rate-limit Redis store | express-rate-limit 8.7.1 + rate-limit-redis 6.0.1 + redis 6.3.0 | Key theo IP phải qua `ipKeyGenerator`. Key theo email băm SHA-256 như §2.4. |
| §5 Socket.io API | socket.io 4.8.4 + @socket.io/redis-adapter 8.3.0 | `socketsLeave`/`disconnectSockets` xác nhận là API v4. |
| §6 helmet/cors/body limit | helmet 8.3.0, cors 2.8.6, `express.json({ limit: "100kb" })` | Express 5.3: `limit` không hợp lệ → throw lúc khởi động (tốt). |
| §7 pino redact | pino 10.4.0 + pino-http 11.0.0 | — |

## 8. Trả lời TODO(T-001) trong `docs/design/data-and-api.md`

Tất cả ở mục này **[ĐÃ CHẠY]** trên Prisma CLI 7.10.0 / Zod 4.6.7.

### 8.1 Khối generator/datasource Prisma 7 (dòng 63)
```prisma
generator client {
  provider        = "prisma-client"
  output          = "../src/generated/prisma"
  previewFeatures = ["partialIndexes"]
}

datasource db {
  provider = "postgresql"   // KHÔNG có url ở đây
}
```
```ts
// apps/api/prisma.config.ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // ⚠️ KHÔNG dùng env("DATABASE_URL"): [ĐÃ CHẠY] nó throw PrismaConfigEnvError khi biến
  // vắng mặt → `prisma generate` trong stage build Docker sẽ fail. Fallback "" cho generate,
  // migrate deploy lúc chạy container vẫn có DATABASE_URL thật.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
```
```ts
// tạo client ở composition root (ADR-016)
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5_000 }),
});
```
Docker: chạy `pnpm exec prisma migrate deploy` (CLI đã pin) khi container khởi động / job migrate riêng — **không `npx prisma`** (sẽ kéo 8.0 RC). Sau `pnpm install` cần `allowBuilds` cho `prisma`/`@prisma/engines` trong `pnpm-workspace.yaml`.

### 8.2 `@default(uuid(7))` + `@db.Uuid` (dòng 31) — ✅ Hỗ trợ
`prisma validate` OK, migrate sinh `"id" UUID NOT NULL` (có từ Prisma 5.18). Lưu ý: UUID do **Prisma Client sinh**, **không có DEFAULT trong DB** → insert bằng `$queryRaw`/SQL tay phải tự truyền id (hoặc thêm tay `DEFAULT uuidv7()` vào migration — PG18 có hàm này).

### 8.3 Collation `"C"` cho `rank` (dòng 54) — ❌ Không có native
Schema reference v7 không có thuộc tính collation cột. Giữ cách của Engineer C: `prisma migrate dev --create-only` rồi thêm `ALTER TABLE "tasks" ALTER COLUMN "rank" TYPE text COLLATE "C";` (https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/customizing-migrations). Lưu ý: `migrate dev` sau này không thấy drift collation (Prisma không quản lý) — ổn, nhưng thêm một test integration khẳng định `ORDER BY rank` khớp so sánh byte.

### 8.4 Partial unique `WHERE deleted_at IS NULL` (dòng 56) — ✅ Hỗ trợ (preview)
```prisma
@@unique([projectId, status, rank], map: "tasks_rank_live_key", where: raw("deleted_at IS NULL"))
```
Sinh đúng: `CREATE UNIQUE INDEX "tasks_rank_live_key" ON "tasks"("project_id","status","rank") WHERE (deleted_at IS NULL);`. Preview `partialIndexes` (từ 7.4.0, chưa GA). 🟡 Đề xuất **dùng native** (Prisma theo dõi được, không drift) thay SQL tay; nếu Tech Lead không muốn preview feature trong production → SQL tay như cũ. Cũng dùng được cho các index partial khác (vd index `deleted_at IS NULL` của task).

### 8.5 `update` với where không-unique (dòng 48) — ✅ nhưng lưu ý
`extendedWhereUnique` GA từ Prisma 5.0 → `where: { id, workspaceId, archivedAt: null }` hợp lệ (vì có `id` unique). **Nhưng `update` không trả 0 dòng — nó throw `P2025`** (`PrismaClientKnownRequestError`) khi không khớp. Use case phải bắt `P2025` (rồi đọc lại để phân biệt 404 / `PROJECT_ARCHIVED`), hoặc dùng `$queryRaw` `UPDATE … RETURNING` như phương án chính của doc. Đề xuất giữ `$queryRaw` (tránh dùng exception cho luồng thường).

### 8.6 Zod 4 (dòng 575) — ✅
| Biểu thức | Kết quả thử |
|---|---|
| `z.iso.date()` | `"2026-10-15"` ✅ · `"2026-10-15T00:00:00Z"` ❌ (đúng ý D10) |
| `z.iso.datetime()` | `"…T10:00:00Z"` ✅ · `"…T10:00:00.123Z"` ✅ · `"…+07:00"` ❌ mặc định — cần `{ offset: true }` nếu chấp nhận offset. Server luôn trả `Z` (`toISOString()`) nên DTO dùng mặc định. |
| `z.uuid()` | chấp nhận v4 và v7 (kiểm tra variant RFC 9562). `z.uuidv7()` / `z.uuid({ version: "v7" })` chỉ nhận v7. 🟡 Đề xuất params dùng `z.uuid()` (không khóa version — id cũ/ngoài vẫn hợp lệ, sai thì 404). |
| `z.email()`, `z.strictObject`, `z.flattenError`, `z.treeifyError`, `z.prettifyError` | đều tồn tại. `z.flattenError(err)` → `{ formErrors: ['Unrecognized key: "b"'], fieldErrors: { a: ["too short"] } }` — khớp envelope `VALIDATION_ERROR`. Lỗi tùy chỉnh: `.min(3, { error: "…" })`. |

## 9. argon2id vs bcrypt cost 12 (cho ADR-048)

**Đo thật [ĐÃ CHẠY]** — Node 24.18, Windows 11, Intel i5-12400F, trung bình 5 lần:

| Thuật toán / tham số | node-argon2 0.45.1 | @node-rs/argon2 2.2.2 |
|---|---|---|
| bcrypt 6.0.0 cost 12 | **219 ms** | — |
| argon2id m=19456 t=2 p=1 (OWASP mức 1) | 26 ms | **16 ms** |
| argon2id m=47104 t=1 p=1 (OWASP) | 43 ms | 27 ms |
| argon2id m=65536 t=3 p=1 | 139 ms | 97 ms |
| argon2id m=65536 t=3 p=4 (mặc định node-argon2) | 52 ms | 48 ms |

**Giới hạn 72 byte [ĐÃ CHẠY]:** mật khẩu 72 byte + hậu tố khác nhau → `bcrypt.compare` = **true** (bcrypt cắt bỏ phần sau byte 72); `argon2.verify` = **false** ở cả hai thư viện → argon2id không có giới hạn 72 byte.

**Cài đặt:**
- Windows dev: cả 3 gói cài không cần build tool [ĐÃ CHẠY].
- Linux: `bcrypt` 6 và `argon2` 0.45 có prebuild `glibc` + `musl` cho x64/arm64 (đã liệt kê trong tarball). `@node-rs/argon2` dùng optionalDependencies theo nền tảng (`linux-x64-gnu`, `linux-x64-musl`, `linux-arm64-gnu/musl`, `win32-x64-msvc`, `darwin-*`) — không node-gyp, không install script → không cần `allowBuilds` trong pnpm 11.
- Chưa chạy được trong container (Docker daemon máy này không bật) — Phase 1 cần smoke test `node -e "require('@node-rs/argon2')"` trong image.

**OWASP** (https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): **Argon2id là lựa chọn đầu tiên**, tối thiểu m=19 MiB/t=2/p=1 (tương đương: m=47104/t=1, m=12288/t=3, m=9216/t=4, m=7168/t=5). bcrypt chỉ cho "legacy systems", work factor ≥10, giới hạn 72 byte.

**Kết luận: KHUYẾN NGHỊ argon2id**, gói **`@node-rs/argon2` 2.2.2**, tham số `{ algorithm: Algorithm.Argon2id, memoryCost: 47104, timeCost: 1, parallelism: 1 }` (OWASP, ≈27 ms/hash trên máy dev).
- Lý do: OWASP xếp hạng cao hơn (memory-hard, chống GPU/ASIC); không cắt 72 byte (bỏ được luật "≤72 byte UTF-8" phức tạp ở FE/BE); rẻ CPU hơn ~8× so với bcrypt 12 → login/register ít nghẽn event loop (vẫn chạy trên threadpool), giúp k6; prebuilt cho mọi nền tảng dự án dùng.
- Chọn `@node-rs/argon2` thay `argon2` (node-argon2): nhanh hơn ~30–40%, không có install script, mặc định đã là OWASP. Đánh đổi: là cộng đồng napi-rs (vẫn active, publish 2026-10-06); node-argon2 là phương án thay thế tương đương (cùng định dạng chuỗi PHC `$argon2id$v=19$…` → hoán đổi được mà không cần migrate hash).
- Bộ nhớ: 46 MiB/hash × số login đồng thời (threadpool mặc định 4) ≈ 184 MiB đỉnh — chấp nhận được; nếu container RAM thấp dùng m=19456/t=2.
- Tác động: security.md §1 (bcrypt → argon2), data-and-api.md:116 (`passwordHash` comment → `$argon2id$`), :369 (bỏ giới hạn 72 byte, thay bằng max 256 byte chống DoS), ADR-030 (login không còn ≈250ms). Dự án chưa có user → không cần migrate hash.
- Nếu Tech Lead giữ bcrypt: `bcrypt@6.0.0` cost 12 vẫn hợp lệ theo OWASP (≥10), giữ luật 72 byte.

---

## 10. Khung monorepo đề xuất

```
TaskFlow_Enterprise/
├─ package.json              # private, "type":"module", "packageManager":"pnpm@11.28.2", engines.node "24.x", scripts root
├─ pnpm-workspace.yaml       # packages, catalog, allowBuilds, minimumReleaseAge
├─ tsconfig.base.json        # (hoặc packages/config/tsconfig/*.json)
├─ eslint.config.mjs         # flat config root, import từ @taskflow/config
├─ .dependency-cruiser.cjs
├─ vitest.config.ts          # test.projects: ["apps/*", "packages/*"]
├─ docker-compose.yml        # postgres:18.6, redis:8.10.2 (dev)
├─ .nvmrc                    # 24.22.0
├─ apps/
│  ├─ api/                   # @taskflow/api — Express 5
│  │  ├─ package.json        # "type":"module"; dev: tsx watch; build: tsdown
│  │  ├─ prisma.config.ts
│  │  ├─ prisma/schema.prisma, prisma/migrations/
│  │  ├─ src/generated/prisma/   # .gitignore
│  │  └─ src/…               # domain/application/infrastructure (theo ADR-004)
│  └─ web/                   # @taskflow/web — Next 16
│     ├─ package.json
│     ├─ next.config.ts
│     ├─ postcss.config.mjs  # @tailwindcss/postcss
│     └─ src/app/globals.css # @import "tailwindcss"; @theme {…}
└─ packages/
   ├─ contracts/             # @taskflow/contracts — Zod schema + type, JIT (không build)
   │  ├─ package.json
   │  └─ src/index.ts …
   └─ config/                # @taskflow/config — eslint preset, tsconfig dùng chung
      ├─ package.json
      ├─ eslint/{base,node,next}.js
      └─ tsconfig/{base,node,next}.json
```

**`pnpm-workspace.yaml`**
```yaml
packages: ["apps/*", "packages/*"]
catalog:                     # 1 nơi chốt version, package.json dùng "zod": "catalog:"
  zod: 4.6.7
  typescript: 6.0.3
  vitest: 5.0.4
  "@vitest/coverage-v8": 5.0.4
  vite: 8.3.4
  socket.io-client: 4.8.4
allowBuilds:                 # pnpm 11: chặn install script mặc định
  prisma: true
  "@prisma/engines": true
  esbuild: true
  "@tailwindcss/oxide": true
minimumReleaseAge: 1440      # mặc định pnpm 11; giữ (chống supply-chain)
```

**`packages/contracts` — kiểu "Just-in-Time internal package"** (https://turborepo.dev/docs/core-concepts/internal-packages):
```json
{
  "name": "@taskflow/contracts",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./*": "./src/*.ts" },
  "dependencies": { "zod": "catalog:" }
}
```
- **Next 16 (Turbopack)** tự transpile workspace package → không cần `transpilePackages`, không bước build.
- **API dev**: `tsx` đọc được `.ts` qua symlink workspace. **API prod**: `tsdown` bundle và inline contracts (`noExternal: [/^@taskflow\//]`) → image runtime không cần TS.
- **Typecheck**: mỗi package có `tsconfig.json` (`moduleResolution: "bundler"`, `noEmit`), `tsc --noEmit` chạy được vì exports trỏ thẳng `.ts`. **Không dùng TS project references** (thêm phức tạp `composite`/`.d.ts` mà dự án nhỏ chưa cần; xem lại nếu typecheck >60s).
- Không dùng `paths` alias xuyên package (vỡ ở JIT) — import bằng tên package `@taskflow/contracts`.
- Rủi ro: Zod có 2 bản trong cây → `instanceof ZodError` sai. Chặn bằng `catalog:` (1 version duy nhất).

**Scripts root (`package.json`)**
```json
{
  "scripts": {
    "dev": "pnpm --parallel --filter @taskflow/api --filter @taskflow/web dev",
    "build": "pnpm -r --filter ./apps/* build",
    "typecheck": "pnpm -r --parallel typecheck",
    "lint": "eslint . --max-warnings=0 && depcruise apps packages --config .dependency-cruiser.cjs",
    "test": "vitest run",
    "test:e2e": "pnpm --filter @taskflow/web exec playwright test",
    "db:migrate": "pnpm --filter @taskflow/api exec prisma migrate dev",
    "db:deploy": "pnpm --filter @taskflow/api exec prisma migrate deploy",
    "db:generate": "pnpm --filter @taskflow/api exec prisma generate",
    "format": "prettier --write ."
  }
}
```
Script con: `apps/api` — `dev: tsx watch src/main.ts`, `build: prisma generate && tsdown`, `typecheck: tsc --noEmit`; `apps/web` — `dev: next dev`, `build: next build`, `typecheck: tsc --noEmit` (sau `next typegen`); `packages/*` — `typecheck: tsc --noEmit`. `postinstall` ở api chạy `prisma generate` để typecheck/test không lỗi thiếu client.
