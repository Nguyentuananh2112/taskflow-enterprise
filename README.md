# TaskFlow Enterprise

Quản lý công việc theo nhóm với **bảng Kanban thời gian thực**: mỗi workspace có thành viên với vai trò (Owner / PM / Member / Viewer), mỗi project là một bảng có cột theo trạng thái. Kéo thả task được đồng bộ tức thì tới mọi người đang mở bảng; mọi thay đổi có lịch sử (audit log). Ưu tiên của v1 là **đúng và an toàn** khi nhiều người sửa cùng lúc — xung đột phiên bản trả `409` để client hòa giải, không ghi đè lặng lẽ.

![Bảng Kanban của một project — dữ liệu demo, không phải dữ liệu thật](docs/assets/board.png)

## Tính năng v1

- Đăng ký / đăng nhập, phiên dài bằng refresh token xoay vòng (cookie `HttpOnly`), đăng xuất mọi thiết bị, đổi mật khẩu.
- Workspace, thành viên + vai trò, project (lưu trữ / khôi phục), xóa mềm workspace có thời gian ân hạn.
- Task: tạo / sửa / gán / xóa, kéo thả giữa cột và trong cột, lịch sử thay đổi theo task.
- Realtime qua Socket.io: thay đổi của người khác hiện ngay; bị thu hồi quyền là bị đẩy ra ngay.
- Bảo mật: chống IDOR theo tenant, rate limit, CSP có nonce, log và Sentry không chứa dữ liệu nhạy cảm (allow-list).

**Chưa có ở v1** (có chủ đích): bình luận trên task (ADR-111), xác minh email khi đăng ký (ADR-049), SSO, đính kèm file — xem [DECISIONS](docs/blueprint/DECISIONS.md).

## Stack

| Phần          | Công nghệ (phiên bản chốt một nơi: `catalog:` trong `pnpm-workspace.yaml`)                               |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Runtime / gói | Node 24 (`.nvmrc`), pnpm 11.28.2 qua corepack, TypeScript 6.0                                            |
| API           | Express 5.3, Prisma 7.10 + PostgreSQL 18, Valkey 9 (node-redis 6.3), Socket.io 4.8, jose (JWT), argon2id |
| Web           | Next.js 16 (App Router) + React 19, Tailwind 4, TanStack Query 5, dnd-kit, React Hook Form               |
| Dùng chung    | Zod 4 — `packages/contracts` là nguồn duy nhất của schema, type, mã lỗi, ma trận quyền                   |
| Chất lượng    | Vitest 5, Stryker (mutation), ESLint 10 + dependency-cruiser (luật kiến trúc), gitleaks, lefthook        |
| Vận hành      | Docker (image api / web / migrate), pino (log JSON), Sentry, Prometheus metrics                          |

## Chạy local trong 5 bước

Hướng dẫn đầy đủ từ máy trắng (Windows, cài công cụ, xử lý lỗi thường gặp): **[docs/runbook/local-dev.md](docs/runbook/local-dev.md)**. Tóm tắt — cần Node 24, Docker Desktop, gitleaks; lệnh dưới đây cho Git Bash / macOS / Linux (PowerShell: xem runbook):

```sh
# 1. Dependency (cũng cài git hook pre-commit)
corepack enable pnpm   # Windows, Node trong Program Files: cần quyền admin — hoặc dùng `corepack pnpm …`
pnpm install

# 2. Postgres + Valkey bằng Docker — cổng host riêng: Postgres 5435, Valkey 6380 (ADR-097)
pnpm infra:up

# 3. Biến môi trường mẫu — giá trị chỉ cho máy dev, KHÔNG commit file đã copy
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 4. Tạo bảng + dữ liệu demo. Chạy bằng user migrator (app chỉ có quyền DML). Seed XÓA dữ liệu cũ.
export DATABASE_URL=postgresql://taskflow_migrator:migrator_local_only@127.0.0.1:5435/taskflow
pnpm --filter @taskflow/api db:deploy
pnpm --filter @taskflow/api db:seed
unset DATABASE_URL

# 5. API :4000 + web :3001
pnpm dev
```

Kiểm tra: <http://localhost:4000/healthz> trả `{"status":"ok"}`, mở <http://localhost:3001> và đăng nhập bằng một user mẫu trong `apps/api/prisma/seed.ts` (email `@example.test`).

## Lệnh hay dùng

| Lệnh                                           | Việc                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | API + web ở chế độ watch                                                                                          |
| `pnpm verify`                                  | Definition of Done: lint · typecheck · test · audit (+ migrate/drift khi có `VERIFY_DB_URL`) — **kiểm exit code** |
| `pnpm typecheck` · `pnpm lint` · `pnpm test`   | Từng bước lẻ                                                                                                      |
| `pnpm format`                                  | Prettier ghi đè                                                                                                   |
| `pnpm build`                                   | Build production (`apps/api/dist`, `apps/web/.next/standalone`)                                                   |
| `pnpm infra:up` · `infra:down` · `infra:reset` | Hạ tầng Docker local (`reset` xóa sạch dữ liệu)                                                                   |
| `pnpm --filter @taskflow/api test:integration` | Test với Postgres thật — `DATABASE_URL_TEST` trỏ DB **riêng của bạn** (runbook §5)                                |
| `pnpm --filter @taskflow/api test:security`    | Suite bảo mật đầu-cuối (SEC-01…58)                                                                                |
| `pnpm docker:build`                            | Build image api + web                                                                                             |

> **Không bao giờ** `npx prisma` (kéo nhầm bản khác — ADR-061): dùng `pnpm exec prisma` hoặc script `db:*`.

## Cấu trúc monorepo

```text
apps/
  api/        Express API — src/core (hạ tầng dùng chung), src/modules/{auth,workspace,task}, src/composition (wiring)
  web/        Next.js — app/ (route mỏng) + src/ theo Feature-Sliced Design (shared → entities → features → widgets → views)
packages/
  contracts/  Zod schema + type + mã lỗi + ma trận quyền dùng chung FE/BE
  config/     tsconfig, ESLint flat config, luật dependency-cruiser + test chứng minh từng luật
docker/       init Postgres (2 user: migrator / app), image migrate
docs/         thiết kế, quyết định (ADR), runbook, báo cáo review
```

## Tài liệu

| Bạn cần                              | Đọc                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hiểu kiến trúc trong 10 phút         | **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**                                                                                                           |
| Đóng góp code (quy trình, DoD, hook) | [CONTRIBUTING.md](CONTRIBUTING.md)                                                                                                                         |
| Báo lỗ hổng bảo mật                  | [SECURITY.md](SECURITY.md) — **không** mở issue công khai                                                                                                  |
| Mọi quyết định và lý do              | [docs/blueprint/DECISIONS.md](docs/blueprint/DECISIONS.md)                                                                                                 |
| API & dữ liệu                        | [docs/design/data-and-api.md](docs/design/data-and-api.md); OpenAPI 3.1 sinh từ contracts: `GET http://localhost:4000/api/docs` (chỉ `APP_ENV` local/test) |
| Bảo mật                              | [docs/design/security.md](docs/design/security.md)                                                                                                         |
| Frontend                             | [docs/design/frontend.md](docs/design/frontend.md)                                                                                                         |
| Vận hành, deploy, giám sát           | [docs/design/devops.md](docs/design/devops.md), [docs/runbook/](docs/runbook/)                                                                             |

## Bản quyền

Mã nguồn được **công khai để tham khảo**; tác giả **giữ toàn quyền** (all rights reserved) — repo không kèm giấy phép mã nguồn mở (ADR-114). Muốn sử dụng, sao chép hay phân phối lại mã, vui lòng liên hệ xin phép trước. Báo lỗ hổng bảo mật theo [SECURITY.md](SECURITY.md).
