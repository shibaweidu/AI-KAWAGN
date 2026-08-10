#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"

failed=0
check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf '[ok] %s\n' "$label"
  else
    printf '[failed] %s\n' "$label"
    failed=1
  fi
}

check "Docker CLI" command -v docker
check "Docker Engine" docker info
check "Docker Compose" docker compose version
check "Production environment file" test -f "$ENV_FILE"

if [[ -f "$ENV_FILE" ]]; then
  if grep -Eq 'replace_|change-me|example\.com' "$ENV_FILE"; then
    echo "[failed] Production environment still contains example values"
    failed=1
  else
    echo "[ok] Production environment has no example values"
  fi
  compose=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.prod.yml")
  check "Compose configuration" "${compose[@]}" config --quiet
  if docker info >/dev/null 2>&1; then
    echo
    "${compose[@]}" ps || true
  fi
fi

available_kb="$(df -Pk "$ROOT_DIR" | awk 'NR==2 {print $4}')"
if [[ "${available_kb:-0}" -ge 3145728 ]]; then
  echo "[ok] At least 3 GB free disk space"
else
  echo "[failed] Less than 3 GB free disk space"
  failed=1
fi

exit "$failed"
