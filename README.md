# AI卡网

面向数字商品授权店铺的聚合比价与导流平台。平台不处理支付、订单或卡密交付。

## 快速开始

```powershell
Copy-Item .env.example .env
pnpm install
docker compose up -d postgres redis meilisearch minio
pnpm db:generate
pnpm db:migrate
pnpm --filter @ai-card/api admin:create
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000/v1/health
- 运营后台: http://localhost:3000/admin

启动前需要在 `.env` 中设置至少 12 位的 `ADMIN_PASSWORD` 和 `ADMIN_EMAIL`。API 固定使用 `DATA_MODE=database`；数据库不可用时会明确失败，不会回退到演示数据。

`pnpm dev` 会编译共享契约与采集器，然后同时启动 Web、API 和 Worker。开发阶段保持来源调度器关闭：

```powershell
ENABLE_SOURCE_SCHEDULERS=false
```

完成来源条款确认和候选审核后，才可在受控环境中启用调度器。所有外部数据先进入候选区，批准前不会出现在公开页面。

## 目录

- `apps/web`: Next.js 前台与运营后台
- `apps/api`: NestJS API 与 Prisma 数据模型
- `apps/worker`: BullMQ 采集 Worker
- `packages/contracts`: 共享 Zod 契约
- `packages/crawler`: 安全 URL 验证、归一化与采集适配器

## 采集边界

- PriceAI 仅读取官方公开快照 Feed，不抓取 HTML 或内部 API。
- 淘卡优仅通过 sitemap 发现候选，并以单并发、至少 5 秒间隔补全新增公开店铺页。
- AIProbe 保持禁用，取得书面授权或公开 API 前不得采集。
- 授权直采仅面向已验证或留存授权证据的 HTTPS 原店；Worker 拒绝凭证 URL、内网 IP、重定向链、异常内容类型和超大响应。
- 前台只展示 `ACTIVE` 且已有 `publishedAt` 的店铺。Feed 报价必须展示来源和观测时间，不得标记为认证店铺或宣称覆盖全部市场报价。
