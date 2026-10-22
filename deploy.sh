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

echo "==> Checking admin static assets are served"
# Proves the whole chain end to end: entrypoint.sh's collectstatic (this build) -> the shared
# static_files volume -> Caddy's /static/* handle_path in deploy/Caddyfile, the same way a browser
# loading the admin login page at ADMIN_URL_PATH would.
status=$(curl -fsS -o /dev/null -w '%{http_code}' https://api.easykharcha.com/static/admin/css/base.css || echo "000")
if [ "$status" != "200" ]; then
  echo "FAIL: /static/admin/css/base.css returned $status, expected 200." >&2
  exit 1
fi
echo "Admin static assets OK (200)."

echo "==> AI worker status"
$COMPOSE ps worker
$COMPOSE logs --tail=20 worker

echo "==> Status"
$COMPOSE ps

echo "==> Pruning old images"
docker image prune -f
