#!/usr/bin/env bash
# Nightly pg_dump → S3. Install: crontab -e → 0 4 * * * /home/ubuntu/kindcaddy/scripts/backup-db.sh
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)
cd "$(dirname "$0")/.."
docker compose exec -T db pg_dump -U kindcaddy kindcaddy | gzip > "/tmp/kindcaddy-$STAMP.sql.gz"
aws s3 cp "/tmp/kindcaddy-$STAMP.sql.gz" "s3://kindcaddy-backups/prod/kindcaddy-$STAMP.sql.gz"
rm -f "/tmp/kindcaddy-$STAMP.sql.gz"
echo "backup ok: kindcaddy-$STAMP.sql.gz"
