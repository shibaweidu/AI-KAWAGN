FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm --filter @ai-card/bot... build
CMD ["node", "apps/bot/dist/main.js"]
