#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="$ROOT_DIR/compose.prod.yml"
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-2}"
# Compose Bake can fail on non-ASCII checkout paths in Docker Desktop. BuildKit caching remains enabled.
export COMPOSE_BAKE="${COMPOSE_BAKE:-false}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  echo "Run: ./scripts/init-production-env.sh <domain-or-server-ip>" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Docker Engine is not available" >&2
  exit 1
fi

if [[ "${PULL_LATEST:-0}" == "1" ]]; then
  git -C "$ROOT_DIR" pull --ff-only
fi

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
"${compose[@]}" config --quiet

if [[ "${BUILD_LOCAL:-0}" == "1" ]]; then
  echo "Building application images locally..."
  "${compose[@]}" build --pull api worker web
else
  echo "Pulling prebuilt application images..."
  if ! "${compose[@]}" pull api worker web; then
    echo "Unable to pull application images." >&2
    echo "For a private GHCR package, run docker login ghcr.io first." >&2
    echo "To build on this server instead, run BUILD_LOCAL=1 ./scripts/deploy.sh" >&2
    exit 1
  fi
fi

"${compose[@]}" pull postgres redis meilisearch minio caddy
"${compose[@]}" up -d --wait postgres redis meilisearch minio
if [[ -n "${SEED_DUMP:-}" ]]; then
  ENV_FILE="$ENV_FILE" START_APP_AFTER_RESTORE=0 \
    "$ROOT_DIR/scripts/restore-seed.sh" "$SEED_DUMP"
fi
"${compose[@]}" up -d --wait --remove-orphans api worker web caddy

"${compose[@]}" exec -T web node -e \
  "fetch('http://api:4000/v1/health').then(r=>{if(!r.ok)process.exit(1);return r.text()}).then(console.log).catch(e=>{console.error(e);process.exit(1)})"
if [[ "${REBUILD_SEARCH_INDEX:-0}" == "1" ]]; then
  echo "Rebuilding Meilisearch offers and shops indexes..."
  "${compose[@]}" exec -T worker node apps/worker/dist/rebuild-search-index.js
fi
"${compose[@]}" ps
echo "Deployment completed."
