# TaskFlow Enterprise

Quản lý công việc theo nhóm với bảng Kanban thời gian thực. pnpm monorepo:

| Gói                  | Vai trò                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `apps/api`           | Express 5 API (`:4000`) — dev bằng `tsx`, build bằng `tsdown`                |
| `apps/web`           | Next.js 16 App Router + Tailwind 4 (`:3000`) — layer FSD trong `src/`        |
| `packages/contracts` | Zod schema + type dùng chung FE/BE (gói JIT, export source `.ts`)            |
| `packages/config`    | tsconfig, ESLint flat config, luật dependency-cruiser + test chứng minh luật |

Tài liệu thiết kế: `docs/` (ưu tiên `docs/blueprint/DECISIONS.md`).

## Yêu cầu

- Node **24.22.0** (xem `.nvmrc`)
- pnpm **11.28.2** — kích hoạt qua corepack (đi kèm Node 24):

  ```sh
  corepack enable pnpm   # lần đầu; pnpm sẽ tự dùng đúng bản ghi trong package.json
  ```

## Bắt đầu

```sh
pnpm install
pnpm dev          # api :4000 + web :3000
```

Kiểm tra: `http://localhost:4000/healthz`, `http://localhost:3000`.

## Lệnh

| Lệnh             | Việc                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm dev`       | Chạy api + web ở chế độ watch                                                                     |
| `pnpm build`     | Build production (`apps/api/dist`, `apps/web/.next/standalone`)                                   |
| `pnpm typecheck` | `tsc --noEmit` mọi gói                                                                            |
| `pnpm lint`      | Prettier check + ESLint (luật kiến trúc ADR-004) + dependency-cruiser (ranh giới tầng/module/FSD) |
| `pnpm test`      | Vitest mọi gói (gồm test chứng minh luật kiến trúc)                                               |
| `pnpm format`    | Prettier ghi đè                                                                                   |

Definition of Done: `pnpm typecheck && pnpm lint && pnpm test` xanh.

## Luật kiến trúc (máy ép)

Định nghĩa trong `packages/config` — vi phạm làm `pnpm lint` đỏ:

- **ESLint** (`packages/config/eslint`): `max-lines` (`.tsx` 150, `.ts` 200, không tính dòng trống/comment);
  tầng `domain` cấm import Prisma/Express/Valkey/Socket.io/Zod/jose/argon2/contracts; chỉ `src/config` đọc `process.env`;
  web: cấm `axios`, cấm `fetch`/`localStorage` ngoài `shared/api`/`shared/lib/storage.ts`, cấm `fetch(` và
  `dangerouslySetInnerHTML` trong `.tsx`, tối đa 3 `useState`/component, thư viện bị khoanh vùng (socket.io-client, @dnd-kit, react-query).
- **dependency-cruiser** (`packages/config/depcruise`): domain → không application/infrastructure; application → không infrastructure;
  module chỉ import module khác qua `modules/<x>/index.ts`; layer FSD chỉ phụ thuộc xuống, không chéo slice, chỉ qua `index.ts`; không vòng lặp.

Mỗi luật có fixture vi phạm trong `packages/config/test/fixtures` và test chứng minh lint bắt được.
Thêm luật mới ⇒ thêm fixture + test tương ứng.

## Quy ước

- Phiên bản thư viện chốt một nơi: `catalog:` trong `pnpm-workspace.yaml`. Thêm gói: `pnpm add --filter <gói> <tên>@catalog:` sau khi khai báo vào catalog.
- **Không bao giờ** `npx prisma` (ADR-061) — dùng `pnpm exec prisma`.
- Không commit `.env`/secret (repo public — ADR-072). Mẫu biến môi trường: `.env.example`.
