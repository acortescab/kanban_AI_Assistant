#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running or is not available." >&2
  exit 1
fi

if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "Missing .env in $ROOT_DIR." >&2
  echo "Copy .env.example to .env and add your OpenRouter API key." >&2
  exit 1
fi

if ! grep -Eq '^[[:space:]]*OPENROUTER_API_KEY=[[:space:]]*[^[:space:]#]' "$ROOT_DIR/.env"; then
  echo "OPENROUTER_API_KEY is missing or empty in $ROOT_DIR/.env." >&2
  exit 1
fi

docker compose up --build -d

for _ in $(seq 1 30); do
  if curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; then
    echo "Docker stack started."
    echo "App: http://localhost:8000"
    exit 0
  fi
  sleep 1
done

echo "Docker container started, but the health endpoint did not become ready in time." >&2
docker compose logs --tail 50
exit 1
