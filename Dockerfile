FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apk add --no-cache libc6-compat && corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/crawler/package.json packages/crawler/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS build
ARG API_ORIGIN=http://api:4000
ENV API_ORIGIN=$API_ORIGIN
COPY . .
RUN pnpm db:generate && pnpm build
RUN pnpm --filter @ai-card/api deploy --prod --legacy /prod/api \
    && pnpm --filter @ai-card/worker deploy --prod --legacy /prod/worker \
    && cd /prod/api \
    && ./node_modules/.bin/prisma generate --schema=prisma/schema.prisma \
    && api_client="$(find /prod/api/node_modules/.pnpm -type d -path '*/node_modules/@prisma/client' -print -quit)" \
    && worker_client="$(find /prod/worker/node_modules/.pnpm -type d -path '*/node_modules/@prisma/client' -print -quit)" \
    && test -n "$api_client" -a -n "$worker_client" \
    && cp -R "$(dirname "$(dirname "$api_client")")/.prisma" "$(dirname "$(dirname "$worker_client")")/.prisma"

FROM node:22-alpine AS api
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app/apps/api
COPY --from=build --chown=node:node /prod/api ./
USER node
EXPOSE 4000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]

FROM node:22-alpine AS worker
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/worker ./apps/worker
COPY --from=build --chown=node:node /prod/api ./apps/api
COPY --from=build --chown=node:node /app/ldxp-shop-directory/sync.mjs /app/ldxp-shop-directory/data.public.json ./ldxp-shop-directory/
USER node
CMD ["node", "apps/worker/dist/main.js"]

FROM node:22-alpine AS web
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
