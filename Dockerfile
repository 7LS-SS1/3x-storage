# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.22.0

FROM node:${NODE_VERSION}-bookworm-slim AS workspace
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.11.0 --activate
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json turbo.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/edge/package.json apps/edge/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/player/package.json packages/player/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM workspace AS build
COPY . .

# Prisma only needs syntactically valid URLs while generating the client.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
ENV DIRECT_DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
# Next.js serializes rewrites during build. This hostname is the private
# Compose service and is never exposed to the browser.
ENV API_URL="http://api:4000"

RUN pnpm --filter @video/shared build \
    && pnpm --filter @video/player build \
    && pnpm --filter @video/database exec prisma generate --schema prisma/schema.prisma \
    && pnpm --filter @video/api build \
    && pnpm --filter @video/worker build \
    && pnpm --filter @video/admin build

RUN pnpm --filter @video/api --prod deploy --legacy /prod/api \
    && pnpm --filter @video/worker --prod deploy --legacy /prod/worker \
    && pnpm --filter @video/database deploy --legacy /prod/migrate \
    && cp packages/database/prisma/schema.prisma /prod/api/prisma-schema.prisma \
    && cp packages/database/prisma/schema.prisma /prod/worker/prisma-schema.prisma \
    && cd /prod/api \
    && node /workspace/packages/database/node_modules/prisma/build/index.js generate --schema prisma-schema.prisma \
    && cd /prod/worker \
    && node /workspace/packages/database/node_modules/prisma/build/index.js generate --schema prisma-schema.prisma \
    && cd /prod/migrate \
    && node /workspace/packages/database/node_modules/prisma/build/index.js generate --schema prisma/schema.prisma

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx

FROM runtime AS admin
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/admin/.next/static ./apps/admin/.next/static
RUN mkdir -p /app/apps/admin/.next/cache \
    && chown -R node:node /app/apps/admin/.next
RUN dpkg --purge --force-remove-essential perl-base
USER node
WORKDIR /app/apps/admin
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]

FROM runtime AS api
WORKDIR /app
COPY --from=build --chown=node:node /prod/api ./
RUN dpkg --purge --force-remove-essential perl-base
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]

FROM node:${NODE_VERSION}-trixie-slim AS worker
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates dumb-init ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
    && mkdir -p /tmp/video-worker \
    && chown node:node /tmp/video-worker
RUN dpkg --purge --force-remove-essential perl-base
WORKDIR /app
COPY --from=build --chown=node:node /prod/worker ./
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "const Redis=require('ioredis');const client=new Redis(process.env.REDIS_URL,{lazyConnect:true,maxRetriesPerRequest:1});client.connect().then(()=>client.ping()).then(result=>{if(result!=='PONG')process.exitCode=1}).catch(()=>{process.exitCode=1}).finally(()=>client.disconnect())"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]

FROM runtime AS migrate
WORKDIR /app
COPY --from=build --chown=node:node /prod/migrate ./
RUN dpkg --purge --force-remove-essential perl-base
USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"]
