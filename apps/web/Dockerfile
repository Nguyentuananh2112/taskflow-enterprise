# syntax=docker/dockerfile:1
# Image web (Next 16 standalone) — devops.md §3.3. Build từ GỐC monorepo:
#   docker build -f apps/web/Dockerfile -t taskflow-web:dev .
# MỘT image cho mọi môi trường: API_URL/WS_URL đọc lúc chạy (ADR-074, frontend.md §3.6) —
# không truyền URL qua build-arg, không dùng NEXT_PUBLIC_*.
ARG NODE_IMAGE=node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

FROM ${NODE_IMAGE} AS base
ENV CI=true \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TF_PNPM_STORE=/opt/pnpm-store \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY package.json ./
RUN corepack enable pnpm && pnpm --version

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch --frozen-lockfile --store-dir "$TF_PNPM_STORE"

FROM deps AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile --store-dir "$TF_PNPM_STORE"
RUN pnpm --filter @taskflow/web build

# ---------- runtime: chỉ output standalone ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# TẠM — ngoại lệ tái lập có chủ đích (devops.md §3): perl-base (gói Essential, không gỡ được) của digest node
# hiện tại là 5.36.0-7+deb12u3, có CVE CRITICAL/HIGH đã vá ở deb12u4 ⇒ nâng RIÊNG gói này từ kho security.
# Không ghim phiên bản (Debian chỉ giữ bản vá mới nhất). GỠ khi Dependabot bump digest node mang perl-base ≥ deb12u4.
RUN apt-get update \
 && apt-get install -y --only-upgrade --no-install-recommends perl-base \
 && rm -rf /var/lib/apt/lists/*
# Gỡ trình quản lý gói đi kèm image node (npm, npx, corepack, yarn 1): runtime chỉ chạy `node` (CMD + healthcheck)
# ⇒ bớt bề mặt tấn công + bớt gói Trivy báo (tar, cross-spawn… trong npm/yarn). Không đổi tính tái lập (vẫn digest).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
# outputFileTracingRoot = gốc monorepo → server.js nằm ở apps/web/ (đã kiểm với Next 16.4.1).
COPY --from=build /repo/apps/web/.next/standalone ./
# Standalone KHÔNG tự copy static và public.
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# Next ghi cache runtime vào .next/cache → thư mục .next phải ghi được bởi user node.
RUN chown -R node:node /app/apps/web/.next
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="taskflow-web" \
      org.opencontainers.image.revision="${GIT_SHA}"
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
