FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm db:generate && pnpm --filter @ai-card/worker... build
CMD ["node", "apps/worker/dist/main.js"]
