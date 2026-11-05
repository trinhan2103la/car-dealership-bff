# syntax=docker/dockerfile:1

# ============================================================================
# car-dealership-bff — multi-stage image (NestJS 12 ESM, pnpm) cho Render.
# - Stage build: cai TOAN BO deps (ca dev) de `nest build` (SWC) xuat ESM ra dist/.
# - Stage runtime: chi production deps + dist/, chay user non-root, node dist/main.js.
# - KHONG hardcode PORT: app doc process.env.PORT (Render tu cap). KHONG chua secret.
# ============================================================================

# --- Stage 1: build -------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app

# pnpm theo dung version khai bao trong package.json ("packageManager": "pnpm@10.11.1").
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate

# Cai dependencies truoc (tan dung layer cache khi source doi ma lockfile khong doi).
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source va build (nest build -> dist/ ESM).
COPY . .
RUN pnpm run build

# --- Stage 2: runtime -----------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate

# Chi production deps (khong gom devDependencies cua stage build).
# --ignore-scripts: bo qua "prepare" (husky — chi dung cho git hook local, la devDependency
# nen khong co trong prod install). Cac prod deps o day khong can postinstall build-step.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts

# Ket qua build.
COPY --from=build /app/dist ./dist

# Chay user non-root (node:24-slim co san user 'node').
USER node

# Tai lieu hoa: app nghe cong tu $PORT (Render cap), mac dinh 3000 neu khong set.
EXPOSE 3000

CMD ["node", "dist/main.js"]
