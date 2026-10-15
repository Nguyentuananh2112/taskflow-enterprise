# T-008 — Khung monorepo + tooling + luật kiến trúc bằng máy

**Giao cho:** Engineer A (`taskflow-enterprise-50`) · **Phase:** 1a · **Cổng chặn:** mọi ticket Phase 1b chờ ticket này merge.

## Nguồn
`docs/blueprint/DECISIONS.md` (đặc biệt ADR-001, 004, 060–065, 072, 093) · `docs/research/stack-versions.md` §10 (khung bạn đã đề xuất) · `docs/design/frontend.md` §2 (luật import FSD) · `docs/TEAM.md` mục "Quy trình code".

## Làm việc
Worktree `../TaskFlow_wt/T-008`, branch `feat/T-008`.

## Việc cần làm
1. Root: `package.json` (`packageManager: pnpm@11.28.x`, engines node 24.x, scripts `dev`/`build`/`typecheck`/`lint`/`test`/`format`), `pnpm-workspace.yaml` (catalog cho phiên bản dùng chung, `allowBuilds`, `minimumReleaseAge`), `.npmrc`, `.nvmrc`/`.node-version`, `.editorconfig`, Prettier.
2. `packages/config`: `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` nếu khả thi), ESLint 10 flat config chung (typescript-eslint).
3. `packages/contracts`: package rỗng có build/export đúng cách tiêu thụ được từ cả API lẫn Next 16 (theo §10), 1 schema mẫu + 1 test để chứng minh pipeline.
4. `apps/api`: Express 5 + tsx dev + tsdown build, `src/server.ts` khởi động được, `GET /healthz` → 200. Cây thư mục `src/core/`, `src/modules/` rỗng (`.gitkeep`). Vitest chạy được.
5. `apps/web`: Next 16 App Router + Tailwind (theo bản T-001), 1 trang trống chạy được, Vitest chạy được.
6. **Luật kiến trúc bằng máy (ADR-004, ADR-093)** — phần quan trọng nhất:
   - ESLint `max-lines`: `.tsx` 150, file backend 200 (bỏ qua dòng trống/comment), `no-restricted-imports`: `**/domain/**` cấm `@prisma/*`, `express`, `redis`, `socket.io`, `zod`, `jose`, `@node-rs/*`, `**/generated/**`.
   - `dependency-cruiser`: domain → không phụ thuộc application/infrastructure/presentation; application → không phụ thuộc infrastructure/presentation; module A không import nội bộ module B (chỉ `modules/<b>/index.ts`); web theo luật layer FSD trong `frontend.md` §2; cấm `axios`; cấm `fetch(` trong `.tsx` (ESLint `no-restricted-syntax`).
   - Mỗi luật có **1 file vi phạm mẫu trong fixture test** chứng minh lint bắt được (rồi không commit vi phạm thật).
7. `.gitignore` đầy đủ; README ngắn: cách cài, lệnh dev.

## Phạm vi sở hữu
Mọi file ở root (trừ `docs/`), `packages/**`, `apps/**`. (Các ticket 1b sẽ chia nhỏ phạm vi sau khi bạn xong.)

## Không làm
Docker/CI (D làm T-011), Prisma schema (C làm T-010), core kernel (bạn làm T-009 sau), UI (E).

## Definition of Done
`pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` xanh trên Windows; `pnpm dev` chạy api :4000 + web :3000. Dán output vào `docs/reviews/T-008-report.md` (viết report trong worktree, commit cùng branch). SendMessage `DONE T-008` cho `taskflow-enterprise-0b` kèm tên branch.
