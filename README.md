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

## 生产部署

生产环境使用 `compose.prod.yml`。GitHub Actions 会在 `master` 更新后构建 API、Worker 和 Web 镜像并推送到 GHCR，服务器只需拉取镜像，不需要在低内存机器上编译 Next.js。

服务器首次部署：

```bash
git clone https://github.com/shibaweidu/AI-KAWAGN.git /opt/ai-card
cd /opt/ai-card
./scripts/init-production-env.sh example.com
./scripts/doctor.sh
./scripts/deploy.sh
```

首次部署时同时恢复种子数据，使用下面这条命令代替最后一行。脚本会在 API 第一次启动前完成迁移和恢复：

```bash
SEED_DUMP=/root/aicard-seed-data-20260810.dump ./scripts/deploy.sh
```

使用服务器 IP 测试时，把 `example.com` 换成服务器 IP，脚本会使用 HTTP `:80`。使用域名时，先把域名 A/AAAA 记录指向服务器，并开放 TCP 80、TCP/UDP 443，Caddy 会自动申请 HTTPS 证书。

如果 GHCR 镜像尚未设为公开，需要先执行 `docker login ghcr.io`。也可以在服务器本地构建：

```bash
BUILD_LOCAL=1 ./scripts/deploy.sh
```

后续更新：

```bash
PULL_LATEST=1 ./scripts/deploy.sh
```

GitHub Actions 同时保留完整 Git 提交哈希镜像。需要回退时，将 `IMAGE_TAG` 临时指定为上一个提交哈希：

```bash
IMAGE_TAG=<git-commit-sha> ./scripts/deploy.sh
```

API 容器每次启动都会先运行 `prisma migrate deploy`。数据库、Redis、Meilisearch、MinIO 和 Caddy 数据使用具名卷，更新容器不会清空数据。

### 数据与管理员

单独恢复尚未启动过应用的空数据库：

```bash
./scripts/restore-seed.sh backups/aicard-seed-data.dump
```

恢复脚本默认拒绝写入已有业务数据的数据库。生产备份和管理员创建：

```bash
./scripts/backup.sh
./scripts/create-admin.sh admin@example.com
```

`.env.production`、`backups/` 和 `*.dump` 已被 Git 忽略，不要上传到 GitHub。生产环境默认关闭来源定时采集，完成来源权限确认后再设置 `ENABLE_SOURCE_SCHEDULERS=true`。

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
