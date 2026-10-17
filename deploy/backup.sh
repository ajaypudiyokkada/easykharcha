#!/usr/bin/env bash
# Run manually, or on a cron — see deploy/README.md for the line, not installed by this script.
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR=/opt/easykharcha/backups
KEEP=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

set -a
# shellcheck disable=SC1091
source deploy/.env.production
set +a

mkdir -p "$BACKUP_DIR"

docker compose -f docker-compose.prod.yml --env-file deploy/.env.production exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/easykharcha_${TIMESTAMP}.sql.gz"

echo "Backup written to $BACKUP_DIR/easykharcha_${TIMESTAMP}.sql.gz"

# Keep only the most recent $KEEP backups.
ls -1t "$BACKUP_DIR"/easykharcha_*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
