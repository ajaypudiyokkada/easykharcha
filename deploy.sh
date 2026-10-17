#!/usr/bin/env bash
# Runs on the server (not on Windows) — see deploy/README.md for first-time setup. Safe to re-run:
# pulls main, rebuilds, restarts, and fails loudly (not silently) if the backend never comes up.
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.prod.yml --env-file deploy/.env.production"

echo "==> Pulling latest main"
git fetch origin
git switch main
git pull --ff-only origin main

echo "==> Building images"
$COMPOSE build

echo "==> Starting services"
$COMPOSE up -d

echo "==> Waiting for the backend to report healthy"
for i in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q backend)" 2>/dev/null || echo "starting")
  if [ "$status" = "healthy" ]; then
    echo "Backend is healthy."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "FAIL: backend did not become healthy in time (last status: $status)." >&2
    $COMPOSE logs --tail=100 backend
    exit 1
  fi
  sleep 2
done

echo "==> Status"
$COMPOSE ps

echo "==> Pruning old images"
docker image prune -f
