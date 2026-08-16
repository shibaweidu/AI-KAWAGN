#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
HOST="${1:-}"

if [[ -z "$HOST" ]]; then
  echo "Usage: $0 <domain-or-server-ip>" >&2
  exit 1
fi
if [[ -e "$ENV_FILE" ]]; then
  echo "Refusing to overwrite existing $ENV_FILE" >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate production secrets" >&2
  exit 1
fi

random_hex() { openssl rand -hex "$1"; }

if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SITE_ADDRESS=":80"
  PUBLIC_URL="http://$HOST"
else
  SITE_ADDRESS="$HOST"
  PUBLIC_URL="https://$HOST"
fi

POSTGRES_PASSWORD="$(random_hex 24)"
MEILI_MASTER_KEY="$(random_hex 24)"
S3_SECRET_KEY="$(random_hex 24)"
JWT_SECRET="$(random_hex 32)"
SUBMISSION_IP_HASH_SECRET="$(random_hex 32)"
WORKER_TOKEN="$(random_hex 32)"
BOT_INTERNAL_SECRET="$(random_hex 32)"
BOT_HASH_SECRET="$(random_hex 32)"
GATEWAY_PROBE_ENCRYPTION_KEY="$(random_hex 32)"

umask 077
{
  printf 'COMPOSE_PROJECT_NAME=ai-card\n'
  printf 'IMAGE_REGISTRY=ghcr.io/shibaweidu\n'
  printf 'IMAGE_TAG=latest\n\n'
  printf 'SITE_ADDRESS=%s\n' "$SITE_ADDRESS"
  printf 'NEXT_PUBLIC_SITE_URL=%s\n' "$PUBLIC_URL"
  printf 'WEB_ORIGIN=%s\n' "$PUBLIC_URL"
  printf 'HTTP_PORT=80\nHTTPS_PORT=443\n\n'
  printf 'POSTGRES_DB=aicard\nPOSTGRES_USER=aicard\n'
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
  printf 'DATABASE_URL=postgresql://aicard:%s@postgres:5432/aicard\n\n' "$POSTGRES_PASSWORD"
  printf 'MEILI_MASTER_KEY=%s\n' "$MEILI_MASTER_KEY"
  printf 'S3_ACCESS_KEY=aicard\nS3_SECRET_KEY=%s\n' "$S3_SECRET_KEY"
  printf 'S3_BUCKET=raw-snapshots\n'
  printf 'JWT_SECRET=%s\n' "$JWT_SECRET"
  printf 'SUBMISSION_IP_HASH_SECRET=%s\n' "$SUBMISSION_IP_HASH_SECRET"
  printf 'WORKER_TOKEN=%s\n\n' "$WORKER_TOKEN"
  printf 'BOT_INTERNAL_SECRET=%s\n' "$BOT_INTERNAL_SECRET"
  printf 'BOT_HASH_SECRET=%s\n' "$BOT_HASH_SECRET"
  printf 'TELEGRAM_BOT_TOKEN=\nTELEGRAM_BOT_ENABLED=false\n'
  printf 'QQ_APP_ID=\nQQ_CLIENT_SECRET=\nQQ_BOT_ENABLED=false\n\n'
  printf 'GATEWAY_PROBE_ENCRYPTION_KEY=%s\n' "$GATEWAY_PROBE_ENCRYPTION_KEY"
  printf 'ENABLE_GATEWAY_PROBES=false\n\n'
  printf 'ENABLE_SOURCE_SCHEDULERS=false\n'
  printf 'CRAWLER_USER_AGENT=AIKawangBot/0.1\n'
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "Created $ENV_FILE"
echo "Public URL: $PUBLIC_URL"
echo "Source schedulers are disabled until data-source permissions are reviewed."
