#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="$ROOT_DIR/compose.prod.yml"
DUMP_FILE="${1:-}"

if [[ -z "$DUMP_FILE" || ! -f "$DUMP_FILE" ]]; then
  echo "Usage: $0 <seed-data.dump>" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
"${compose[@]}" up -d --wait postgres
"${compose[@]}" run --rm --no-deps api ./node_modules/.bin/prisma migrate deploy

# PostgreSQL variables expand inside the container.
# shellcheck disable=SC2016
row_count="$("${compose[@]}" exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc '\''SELECT (SELECT count(*) FROM "User") + (SELECT count(*) FROM "Shop") + (SELECT count(*) FROM "DataSource");'\''')"
row_count="${row_count//[[:space:]]/}"
if [[ "${row_count:-0}" != "0" && "${ALLOW_NONEMPTY_RESTORE:-0}" != "1" ]]; then
  echo "Refusing to restore into a non-empty database ($row_count core rows)." >&2
  echo "Create a backup first. Set ALLOW_NONEMPTY_RESTORE=1 only if conflicts are expected and understood." >&2
  exit 1
fi

"${compose[@]}" cp "$DUMP_FILE" postgres:/tmp/aicard-seed.dump
# PostgreSQL variables expand inside the container.
# shellcheck disable=SC2016
"${compose[@]}" exec -T postgres sh -c \
  'pg_restore --exit-on-error --data-only --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/aicard-seed.dump'
"${compose[@]}" exec -T postgres rm -f /tmp/aicard-seed.dump

if [[ "${START_APP_AFTER_RESTORE:-1}" == "1" ]]; then
  "${compose[@]}" up -d --wait api worker web caddy
fi
echo "Seed data restored successfully."
