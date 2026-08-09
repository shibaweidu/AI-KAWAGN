FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm --filter @ai-card/web... build
EXPOSE 3000
CMD ["pnpm", "--filter", "@ai-card/web", "start"]
