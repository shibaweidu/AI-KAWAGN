FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm db:generate && pnpm --filter @ai-card/api... build
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
