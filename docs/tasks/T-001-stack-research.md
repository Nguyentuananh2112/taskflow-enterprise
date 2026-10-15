# T-001 — Nghiên cứu & khóa phiên bản stack

**Giao cho:** Engineer A (`taskflow-enterprise-50`) · **Phase:** 0 · **Loại:** nghiên cứu, KHÔNG viết code ứng dụng

## Bối cảnh
Đọc `docs/TEAM.md`, `docs/blueprint/DECISIONS.md` trước. Hôm nay là 2026-10-15. Dự án chạy production thật, pnpm monorepo (ADR-001).

## Việc cần làm
Với từng thư viện dưới đây, xác minh **phiên bản ổn định mới nhất** (dùng `npm view <pkg> version` / `dist-tags` và docs chính thức), và tóm tắt **breaking changes / cách dùng đúng** liên quan tới dự án:

| Nhóm | Gói |
|---|---|
| Runtime | Node LTS hiện tại, pnpm, TypeScript |
| Backend | express (v5: async errors, path-to-regexp mới), zod (v4: lỗi, `z.uuid()`, flatten), prisma + @prisma/client (v7: generator mới? `prisma.config.ts`? driver adapter `@prisma/adapter-pg` bắt buộc? datasource url ở đâu? migrate trong Docker), socket.io + @socket.io/redis-adapter, ioredis hoặc node-redis (chọn 1, lý do), bcrypt vs argon2 (giữ bcrypt cost 12 trừ khi có lý do mạnh), jsonwebtoken vs jose (chọn 1), helmet, cors, cookie-parser, express-rate-limit + rate-limit-redis, pino + pino-http, fractional-indexing |
| Frontend | next (v16: App Router, thay đổi caching, `middleware`→`proxy`?, Turbopack mặc định?), react, tailwindcss (v4: cấu hình CSS-first, không còn tailwind.config.ts?), @tanstack/react-query, axios (hay fetch wrapper), @dnd-kit, socket.io-client |
| Tooling | eslint (flat config) + typescript-eslint, eslint-plugin-react-hooks, dependency-cruiser, prettier, vitest, @playwright/test, k6, tsx hoặc tsup cho build API |
| Hạ tầng | Docker image tag: postgres (17 hay 18), redis (7 hay 8 — lưu ý giấy phép), node alpine/slim |

Với mỗi mục ghi: **phiên bản đề xuất pin**, nguồn (URL), 1–3 dòng lưu ý. Đánh dấu ⚠️ những chỗ ADR hiện tại sai hoặc cần đổi (vd: nếu Prisma 7 thay đổi cách viết schema, nếu Tailwind 4 bỏ `tailwind.config.ts`).

Thêm một mục cuối: **"Khung monorepo đề xuất"** — cây thư mục root (`pnpm-workspace.yaml`, `apps/api`, `apps/web`, `packages/contracts`, `packages/config`), cách `packages/contracts` được build/tiêu thụ bởi cả Next 16 và API (TS project references? export source trực tiếp?), và các script root (`dev`, `build`, `typecheck`, `lint`, `test`).

## Phạm vi sở hữu (chỉ được ghi)
- `docs/research/stack-versions.md`
- `docs/reviews/T-001-report.md`

## Không làm
Không `pnpm init`, không cài gói vào repo, không tạo `apps/`. (Chạy `npm view` thì được.)

## Hoàn thành khi
File nghiên cứu đủ các mục trên, có nguồn; báo cáo xong; SendMessage `DONE T-001` cho `taskflow-enterprise-0b`.
