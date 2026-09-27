#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running or is not available." >&2
  exit 1
fi

if docker compose ps --services --filter status=running | grep -q .; then
  echo "Stopping existing Docker stack before restart..."
  docker compose down --remove-orphans >/dev/null 2>&1 || true
fi

docker compose up --build -d

for attempt in $(seq 1 30); do
  if curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; then
    echo "Docker stack started."
    echo "App: http://localhost:8000"
    exit 0
  fi
  sleep 1
done

echo "Docker container started, but the health endpoint did not become ready in time." >&2
docker compose logs --tail 50 >&2
exit 1
