#!/usr/bin/env bash
# Secondary logical backup: pg_dump the RDS database → S3.
#
# RDS automated backups + point-in-time recovery are the PRIMARY safety net
# (configured by scripts/provision-rds.sh, --backup-retention-period). This
# script adds an independent, portable logical dump you can restore anywhere.
#
# Install: crontab -e → 0 4 * * * /home/ubuntu/kindcaddy/scripts/backup-db.sh
# Requires: postgresql-client (pg_dump) + awscli, and DATABASE_URL exported or
# present in frontend/.env.production.
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)
cd "$(dirname "$0")/.."

# Load DATABASE_URL from the app env file if not already exported.
if [ -z "${DATABASE_URL:-}" ] && [ -f frontend/.env.production ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' frontend/.env.production | head -1 | cut -d= -f2- | tr -d '"')
fi
: "${DATABASE_URL:?DATABASE_URL not set and not found in frontend/.env.production}"

pg_dump "$DATABASE_URL" | gzip > "/tmp/kindcaddy-$STAMP.sql.gz"
aws s3 cp "/tmp/kindcaddy-$STAMP.sql.gz" "s3://kindcaddy-backups/prod/kindcaddy-$STAMP.sql.gz"
rm -f "/tmp/kindcaddy-$STAMP.sql.gz"
echo "backup ok: kindcaddy-$STAMP.sql.gz"
