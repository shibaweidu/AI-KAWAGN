#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
EMAIL="${1:-}"

if [[ -z "$EMAIL" ]]; then
  echo "Usage: $0 <admin-email>" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

read -r -s -p "Admin password: " PASSWORD
echo
if [[ ${#PASSWORD} -lt 12 ]]; then
  echo "Password must contain at least 12 characters" >&2
  exit 1
fi

compose=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.prod.yml")
"${compose[@]}" run --rm --no-deps \
  -e ADMIN_EMAIL="$EMAIL" -e ADMIN_PASSWORD="$PASSWORD" \
  api node dist/create-admin.js
