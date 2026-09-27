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

echo "Starting Docker stack in the foreground. Press Ctrl+C to stop it."

docker compose up --build
