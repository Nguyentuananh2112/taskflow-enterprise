# syntax=docker/dockerfile:1
# Image API — devops.md §3.1–3.2. Build từ GỐC monorepo:
#   docker build -f apps/api/Dockerfile --target runtime -t taskflow-api:dev .
#   docker build -f apps/api/Dockerfile --target migrate -t taskflow-api-migrate:dev .
# Store pnpm nằm trong layer `deps` (chỉ đổi khi lockfile đổi): cache layer của CI (type=gha) giữ được nó,
# còn cache mount BuildKit thì không (T-022). `install` chạy --offline; `deploy` cần metadata gói mà `pnpm fetch`
# không lưu (ERR_PNPM_NO_OFFLINE_META) ⇒ --prefer-offline: tarball lấy từ store, chỉ lên mạng khi thiếu metadata.
# Base image ghim tag + digest (Dependabot cập nhật). Debian slim (glibc) — stack-versions §6.
ARG NODE_IMAGE=node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

# ---------- base: pnpm qua corepack, dùng được bởi cả root lẫn user node ----------
FROM ${NODE_IMAGE} AS base
ENV CI=true \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TF_PNPM_STORE=/opt/pnpm-store \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
# CHECKPOINT_DISABLE / PRISMA_HIDE_UPDATE_MESSAGE: Prisma CLI không gọi mạng kiểm tra phiên bản/telemetry
# (có thể treo 120s+ trên mạng chậm; production không gửi dữ liệu ra ngoài) — T-022.
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

# ---------- install: cài offline toàn workspace (dùng chung cho build và migrate-files) ----------
FROM deps AS install
COPY . .
RUN pnpm install --offline --frozen-lockfile --store-dir "$TF_PNPM_STORE"

# ---------- migrate-files: Prisma CLI + đúng phụ thuộc (theo lockfile) + prisma/ + prisma.config.ts ----------
# Tách khỏi stage build ⇒ `--target migrate` không phải chờ build/deploy; BuildKit chạy hai nhánh song song.
FROM install AS migrate-files
RUN node docker/migrate/collect-prisma.mjs apps/api /migrate

# ---------- build: build, tách node_modules production ----------
FROM install AS build
# Script build tự `prisma generate` (src/generated, gitignore) rồi tsdown (T-022). DATABASE_URL vắng ⇒ "" — đủ cho generate.
RUN pnpm --filter @taskflow/api build
# Chỉ dependencies runtime của api (gồm @node-rs/argon2 đúng nền tảng linux-x64-gnu/arm64-gnu).
RUN pnpm --filter @taskflow/api deploy --prod --prefer-offline --store-dir "$TF_PNPM_STORE" /out

# ---------- migrate: job chạy TRƯỚC rollout (devops.md §4.1), không chạy trong app start ----------
# DATABASE_URL = user taskflow_migrator (DDL), kết nối thẳng — không qua pooler.
# Chỉ Prisma CLI đã ghim theo lockfile (không pnpm, không source app). Gọi thẳng file CLI trong node_modules —
# cùng tinh thần ADR-061 (không bao giờ kéo bản Prisma chưa ghim như `npx`).
FROM ${NODE_IMAGE} AS migrate
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
COPY --from=migrate-files /migrate ./
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

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
