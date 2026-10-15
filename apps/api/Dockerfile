# syntax=docker/dockerfile:1
# Image API — devops.md §3.1–3.2. Build từ GỐC monorepo:
#   docker build -f apps/api/Dockerfile --target runtime -t taskflow-api:dev .
#   docker build -f apps/api/Dockerfile --target migrate -t taskflow-api-migrate:dev .
# Base image ghim tag + digest (Dependabot cập nhật). Debian slim (glibc) — stack-versions §6.
ARG NODE_IMAGE=node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

# ---------- base: pnpm qua corepack, dùng được bởi cả root lẫn user node ----------
FROM ${NODE_IMAGE} AS base
ENV CI=true \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TF_PNPM_STORE=/opt/pnpm-store
WORKDIR /repo
COPY package.json ./
# Tải đúng pnpm trong "packageManager" (11.28.2) một lần, mở quyền đọc cho user node (stage migrate).
RUN corepack enable pnpm \
 && pnpm --version \
 && chmod -R a+rX "$COREPACK_HOME"

# ---------- deps: chỉ đổi khi lockfile đổi → cache layer ----------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch --frozen-lockfile --store-dir "$TF_PNPM_STORE"

# ---------- build: cài offline, build, tách node_modules production ----------
FROM deps AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile --store-dir "$TF_PNPM_STORE"
# Script build của api tự gọi `prisma generate` khi T-010 thêm Prisma (ADR-061: chỉ `pnpm exec prisma`).
RUN pnpm --filter @taskflow/api build
# Chỉ dependencies runtime của api (gồm @node-rs/argon2 đúng nền tảng linux-x64-gnu/arm64-gnu).
RUN pnpm --filter @taskflow/api deploy --prod --store-dir "$TF_PNPM_STORE" /out

# ---------- migrate: job chạy TRƯỚC rollout (devops.md §4.1), không chạy trong app start ----------
# Dùng được sau khi T-010 thêm prisma 7.10.0 + prisma.config.ts. DATABASE_URL = user taskflow_migrator.
FROM build AS migrate
WORKDIR /repo/apps/api
USER node
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---------- runtime: không pnpm, không devDependencies, không source TS ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="taskflow-api" \
      org.opencontainers.image.revision="${GIT_SHA}"
USER node
EXPOSE 4000
# Slim không có curl → dùng fetch của Node. Liveness thuần, không chạm DB/Valkey (devops.md §6.2).
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Dạng exec, không qua pnpm/npm → nhận SIGTERM trực tiếp (graceful shutdown, §7.3). Compose đặt init: true.
CMD ["node", "dist/main.js"]
