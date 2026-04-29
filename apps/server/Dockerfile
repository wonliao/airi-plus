FROM node:24-alpine

WORKDIR /app

RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY patches/ ./patches/
COPY apps/server apps/server
COPY packages/server-schema packages/server-schema
COPY packages/server-sdk-shared packages/server-sdk-shared
COPY packages/stage-shared packages/stage-shared

# NOTICE: The server image does not run srvx, but the monorepo-level pnpm
# patch for srvx can fail in this pruned Docker context. Keep the workspace
# patch strict outside this production server image.
RUN --mount=type=cache,id=pnpm-store,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile --ignore-scripts --config.ignore-patch-failures=true

RUN pnpm -F @proj-airi/server-schema run build
RUN pnpm -F @proj-airi/server-sdk-shared run build
RUN pnpm -F @proj-airi/server run build

EXPOSE 3000

CMD ["pnpm", "-F", "@proj-airi/server", "start"]
