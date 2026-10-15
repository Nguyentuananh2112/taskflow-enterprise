# T-008 Report — Khung monorepo + tooling + luật kiến trúc bằng máy

Engineer A (`taskflow-enterprise-50`) · 2026-10-15 · Branch `feat/T-008` (worktree `D:\TaskFlow_wt\T-008`, đã rebase lên `main` @ `fb41b5c`)

## Kết quả Definition of Done (Windows 11, cài sạch: xóa mọi `node_modules`/`dist`/`.next` trước khi chạy)

```text
$ node -v && pnpm -v
v24.18.0
11.28.2

$ pnpm install --frozen-lockfile
✓ Lockfile passes supply-chain policies
Packages: +392
Done in 26.7s using pnpm v11.28.2                                   [exit 0]

$ pnpm typecheck        (pnpm -r typecheck)
packages/config · packages/contracts · apps/api: tsc --noEmit — Done
apps/web: next typegen && tsc --noEmit — ✓ Types generated — Done  [exit 0]

$ pnpm lint             (prettier --check && eslint . --max-warnings=0 && pnpm -r lint:deps)
apps/api lint:deps: ✔ no dependency violations found (8 modules, 10 dependencies cruised)
apps/web lint:deps: ✔ no dependency violations found (12 modules, 10 dependencies cruised)
                                                                    [exit 0]
$ pnpm test             (vitest run, 4 project: config · contracts · api · web)
 Test Files  6 passed (6)
      Tests  74 passed (74)                                         [exit 0]

$ pnpm build            (pnpm -r build)
apps/api: tsdown → dist\main.js 1.34 kB ✔ Build complete
apps/web: ▲ Next.js 16.4.1 (Turbopack) ✓ Compiled successfully
          Route (app): ○ /  ○ /_not-found  ƒ /api/healthz           [exit 0]
```

`pnpm dev` (đã chạy, rồi dừng):
```text
apps/api dev: [api] listening on :4000 (development)
apps/web dev: ▲ Next.js 16.4.1 (Turbopack) - Local: http://localhost:3000 ✓ Ready in 441ms
curl :4000/healthz      → HTTP/1.1 200 OK {"status":"ok","gitSha":"dev"}
curl :3000/             → 200, <h1 class="text-3xl font-semibold tracking-tight">TaskFlow</h1> (Tailwind đã biên dịch)
curl :3000/api/healthz  → 200 {"status":"ok","gitSha":"dev"}
```
Bản build API chạy độc lập: `PORT=4010 GIT_SHA=abc123 node dist/main.js` → `GET /healthz` 200 `{"status":"ok","gitSha":"abc123"}`.

## Đã làm

| Mục ticket | Kết quả |
|---|---|
| 1. Root | `package.json` (`packageManager: pnpm@11.28.2`, `engines.node: 24.x`, scripts `dev/build/typecheck/lint/test/format`), `pnpm-workspace.yaml` (**catalog** chốt mọi phiên bản dùng chung, `allowBuilds`, `minimumReleaseAge: 1440`, `engineStrict`), `.npmrc` (chỉ registry — pnpm 11), `.nvmrc`/`.node-version` 24.22.0, `.editorconfig`, Prettier, `tsconfig.json` + `eslint.config.js` + `vitest.config.ts` (projects) ở root. |
| 2. `packages/config` | `tsconfig/{base,node,next}.json` — TS 6.0.3, `strict`, `noUncheckedIndexedAccess`, **`exactOptionalPropertyTypes` (khả thi, đang bật)**, `verbatimModuleSyntax`, `types: []` (TS 6). ESLint 10 flat config `eslint/index.js` (factory `taskflow({ rootDir, api, web })`): `@eslint/js` + typescript-eslint **typed linting** (`recommendedTypeChecked`, projectService) + react-hooks 7 + `@next/eslint-plugin-next` + eslint-config-prettier. |
| 3. `packages/contracts` | Gói JIT (`exports: ./src/index.ts`), `Uuid`/`DateOnly`/`IsoDateTime` (Zod 4) + `HealthzResponse`, 2 test. Tiêu thụ thật bởi API (type `/healthz` + test parse) và Next (route `/api/healthz` parse lúc chạy) → chứng minh cả Turbopack lẫn tsx/tsdown đọc được. |
| 4. `apps/api` | Express 5.3, `src/server.ts` (`createServer(env)` — factory, test dùng trực tiếp) + `src/main.ts` (đọc env, listen, đóng gọn khi SIGINT/SIGTERM), `src/config/env.ts` (Zod, nơi duy nhất đọc `process.env`), `GET /healthz` → `{status, gitSha}` (devops.md §6.2), `src/core/` + `src/modules/` rỗng, `tsx watch` dev, `tsdown` build → **`dist/main.js`** (khớp CMD Dockerfile devops.md §3.1), Vitest + test `/healthz`, `.env.example`. |
| 5. `apps/web` | Next 16.4.1 App Router ở **`apps/web/app/`** (gốc), layer FSD ở `src/` (`app/styles`, `views/home`, `widgets`, `features`, `entities`, `shared`), Tailwind 4 CSS-first (`src/app/styles/globals.css`, không `tailwind.config.*`), `output: 'standalone'`, `/api/healthz`, Vitest (jsdom + Testing Library) + test cấu trúc (không có `pages/`, `src/pages/`). Khớp quyết định Tech Lead nhận lúc đang làm. |
| 6. Luật kiến trúc | Xem mục dưới — **mọi luật có fixture vi phạm + test**. |
| 7. `.gitignore`, README | `.gitignore` đầy đủ (env/secret, build, test, `src/generated`, `next-env.d.ts`, `apps/web/AGENTS.md`); README: yêu cầu, cài đặt, lệnh, luật kiến trúc, quy ước. |

## Luật kiến trúc bằng máy (ADR-004, ADR-093, frontend.md §2.4)

Fixture ở `packages/config/test/fixtures/{eslint,depcruise}` (93 file, sinh 1 lần rồi commit; đã loại khỏi lint/typecheck/prettier của repo). Test:
- `test/eslint-architecture.test.ts` — chạy ESLint API với chính factory `taskflow()` trên fixture; với mỗi luật: file vi phạm **phải** có lỗi đúng `ruleId`, file hợp lệ **không** dính luật kiến trúc nào.
- `test/depcruise-architecture.test.ts` — chạy **đúng CLI `depcruise`** (cùng config, cùng resolve alias `@/` qua tsconfig như `pnpm lint`); mỗi luật có ≥1 vi phạm phải bị bắt, các import hợp lệ không bị báo, và **không có vi phạm nào ngoài danh sách khai báo** (chống luật bắt nhầm).
- **Kiểm tra đột biến**: cố ý làm hỏng `fsd-no-cross-slice` và nới `max-lines` .tsx lên 999 ⇒ 3 test đỏ đúng chỗ; đã khôi phục.

| Luật | Công cụ | Fixture vi phạm (đỏ) | Fixture hợp lệ (xanh) |
|---|---|---|---|
| `max-lines` .tsx 150 / .ts 200 (web), 200 (API), bỏ dòng trống+comment | ESLint | `too-long.tsx`, `too-long.ts` ×2 | `long-but-comments.ts` (200 dòng code + comment) |
| domain cấm `@prisma/*`, `prisma`, `pg`, `**/generated/**`, `express`, `redis`, `socket.io`, `zod`, `jose`, `@node-rs/*`, `@taskflow/contracts` (ADR-043), `pino` | ESLint `no-restricted-imports` | 10 file `imports-*.ts` | `task.entity.ts` |
| chỉ `src/config` đọc `process.env` (devops.md §2.4) | ESLint `no-restricted-properties` | `reads-env.ts` | `config/env.ts` |
| cấm `axios` | ESLint + depcruise | `uses-axios.ts` (api, web) | — |
| cấm `fetch(` / `window.fetch(` và `dangerouslySetInnerHTML` trong `.tsx` | ESLint `no-restricted-syntax` | `calls-fetch.tsx`, `calls-window-fetch.tsx`, `dangerous-html.tsx` | — |
| `fetch`/`XMLHttpRequest`/`localStorage`/`sessionStorage` chỉ trong `shared/api` / `shared/lib/storage.ts` | ESLint `no-restricted-globals` | `fetch-global.ts`, `local-storage.ts` | `shared/api/http.ts`, `shared/lib/storage.ts` |
| tối đa 3 `useState`/component | ESLint `taskflow/max-use-state` (rule tự viết) | `many-state.tsx` | `three-state.tsx` |
| socket.io-client chỉ `shared/socket`; @dnd-kit chỉ `widgets/kanban-board` + `features/task-move`; react-query cấm trong `shared/ui` | ESLint (mỗi vùng khai đủ bộ option) | `uses-socket.ts`, `uses-dnd.tsx`, `uses-react-query.ts` | `shared/socket/client.ts`, `kanban-board/ui/board.tsx`, `task-move/model/use-move.ts` |
| import slice chỉ qua `@/<layer>/<slice>` | ESLint (regex) + depcruise | `deep-import.ts` | `public-import.ts` (index, `@x`, `shared/ui/button`) |
| `domain-is-pure`, `application-no-infra` | depcruise | `uses-application.ts`, `uses-infrastructure.ts` | `create-task.ts` |
| `module-public-api-only` (ADR-093) | depcruise | `uses-task-internal.ts` | `uses-task-public.ts` (qua `index.ts`) |
| `core-no-modules`, `no-web-from-api`, `no-api-app`, `no-circular` | depcruise | `uses-module.ts`, `uses-web.ts`, `uses-api.ts`, `cycle-a/b.ts` (api, web) | — |
| FSD `fsd-no-upward-{shared,entities,features,widgets,views}` | depcruise | 5 file `uses-*.ts` | `src/app/providers.ts` |
| `fsd-no-cross-slice` (features, widgets) | depcruise | `uses-other-feature.ts`, `uses-other-widget.ts` | `composes-features.ts` (widget ghép 2 feature) |
| `fsd-entities-cross-via-x` (chỉ `entities/A/@x/<tên-mình>.ts`) | depcruise | `uses-user-internal.ts`, `uses-other-x.ts`, `uses-user-index.ts` | `uses-user-x.ts` |
| `fsd-public-api-only` (+ `-outside`), feature không dùng `@x` | depcruise | `deep-import.ts`, `uses-entity-x.ts`, `src/app/deep-import.ts` | `edit.ts` (import sâu **trong** cùng slice) |
| `route-files-thin` (`app/` chỉ import views + src/app) | depcruise | `app/board/page.ts` | `app/page.ts` |
| không có `apps/web/pages`, `apps/web/src/pages` | Vitest `apps/web/test/structure.test.ts` | — | — |

## Quyết định tự đưa ra (Tech Lead có thể bác)

1. **Ngoại lệ `minimumReleaseAge` cho bản vá bảo mật**: ngày 2026-10-14 React công bố **GHSA-xqc2-xf4c-x3h3 (critical — RCE không xác thực trong React Server Components)**, vá ở `react@19.3.1`; Next công bố **GHSA-673q-mjm6-r5xr, GHSA-2464-fhr4-w9xw (critical — RCE)** + GHSA-p3m5-59mp-jv5r (high), vá ở `next@16.4.1`. Cả hai < 24h tuổi nên bị `minimumReleaseAge` chặn. Tôi pin bản đã vá và thêm `minimumReleaseAgeExclude: [react, react-dom, scheduler, next, '@next/*']` có comment nguồn — **xóa danh sách này sau 2026-10-15** (khi các bản đã đủ 24h). ⚠️ Ghi chú cho T-001: stack-versions.md ghi next 16.4.1 / react 19.3.1 — vẫn đúng, nay thêm lý do bảo mật.
2. **Một factory ESLint** `packages/config/eslint/index.js` (thay vì tách `eslint/next.js` như frontend.md §2.4 gợi ý): luật API và web dùng chung helper, root `eslint.config.js` 8 dòng. Có thể tách file khi T-012 thêm nhiều luật web.
3. Luật thư viện bị khoanh vùng (socket.io-client, @dnd-kit, react-query) làm bằng **ESLint**, không lặp ở depcruise. Flat config không gộp option của cùng rule ⇒ mỗi vùng khai đủ bộ `no-restricted-imports` (helper `webImports`).
4. Không có `eslint-plugin-react` (chưa hỗ trợ ESLint 10) ⇒ `react/no-danger` thay bằng `no-restricted-syntax`; `react/jsx-key` chưa có thay thế (TS/React runtime cảnh báo). `@next/eslint-plugin-next@16.4.1` **chạy được với ESLint 10** (ADR-064 điều kiện "nếu tương thích" — đạt).
5. Thêm luật ngoài ticket nhưng có trong tài liệu đã duyệt: chỉ `src/config` đọc `process.env` (devops.md §2.4), domain cấm `@taskflow/contracts` (ADR-043) và `pino`, `core-no-modules`, `no-circular`, `taskflow/max-use-state`.
6. **`pnpm lint` gồm `prettier --check`** (định dạng cũng là "máy ép"). Fixture nằm trong `.prettierignore` vì số dòng có nghĩa với test `max-lines`.
7. Entry API là `src/main.ts` (khởi động) + `src/server.ts` (factory) — ticket ghi "`src/server.ts` khởi động được"; tách để test không phải mở cổng cố định và để build ra `dist/main.js` đúng như devops.md.
8. `apps/web/AGENTS.md` (Next 16.4 tự sinh mỗi lần `next dev`, trỏ AI agent tới docs Next trong `node_modules`) — **gitignore**, không tắt: hữu ích cho các session Claude của team vì kiến thức huấn luyện cũ hơn Next 16.4.
9. Không dùng turbo / TS project references (đúng stack-versions §10). Typed linting bật cho mọi `.ts/.tsx` (bắt `no-floating-promises`, `no-misused-promises` — quan trọng với Express 5).
10. `pnpm` gọi qua corepack (`corepack enable pnpm`) — README hướng dẫn. Máy dev này có Node **24.18.0** (< 24.22.0 trong `.nvmrc`); `engines: 24.x` chấp nhận, nhưng nên nâng.

## Rủi ro / việc để lại

- `minimumReleaseAgeExclude` phải được gỡ sau khi các bản vá đủ 24h (một commit nhỏ — ai cũng làm được; đề xuất T-009 hoặc T-011 gỡ).
- Chưa smoke test `@node-rs/argon2` trong container (ADR-065) — cần Docker (T-011). Máy này Docker daemon không chạy.
- `@dnd-kit/react`, `socket.io-client`, `@tanstack/react-query` **chưa cài** (T-012); luật khoanh vùng đã có và đã test bằng fixture (import không cần cài để ESLint bắt).
- Prisma (T-010): `allowBuilds` hiện chưa có `prisma`/`@prisma/engines` — C thêm khi cài. Luật domain đã chặn sẵn `**/generated/**`.
- `exactOptionalPropertyTypes` đang bật và xanh ở khung; có thể gây ma sát với vài kiểu thư viện ở Phase 2 — nếu quá tốn, Tech Lead quyết tắt.

## Câu hỏi mở

1. Giữ `prettier --check` trong `pnpm lint` (đề xuất) hay tách ra CI?
2. Đồng ý tách `main.ts`/`server.ts` (mục 7)?
