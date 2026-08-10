#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
COMPOSE_FILE="$ROOT_DIR/compose.prod.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
"${compose[@]}" up -d --wait postgres
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
backup_file="$BACKUP_DIR/aicard-$(date -u +%Y%m%dT%H%M%SZ).dump"
umask 077

# PostgreSQL variables expand inside the container.
# shellcheck disable=SC2016
"${compose[@]}" exec -T postgres sh -c \
  'pg_dump -Fc --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup_file"
sha256sum "$backup_file" > "$backup_file.sha256"
echo "Created $backup_file"
