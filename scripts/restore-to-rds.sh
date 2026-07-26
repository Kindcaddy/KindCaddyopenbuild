#!/usr/bin/env bash
# One-time cutover helper: load an existing logical dump into the new RDS
# instance, then apply migrations. Use this when moving data off the old
# self-hosted Postgres container onto managed RDS.
#
# Usage:
#   DATABASE_URL="postgresql://kindcaddy:...@<rds-endpoint>:5432/kindcaddy?sslmode=require" \
#   ./scripts/restore-to-rds.sh s3://kindcaddy-backups/prod/kindcaddy-YYYYMMDD-HHMMSS.sql.gz
#
# Or pass a local *.sql.gz path instead of an s3:// URI.
# Requires: postgresql-client (psql), awscli (for s3 sources).
set -euo pipefail
SRC="${1:?Pass an s3:// URI or local path to a .sql.gz dump}"
: "${DATABASE_URL:?Set DATABASE_URL to the RDS connection string}"
cd "$(dirname "$0")/.."

TMP="/tmp/kindcaddy-restore-$(date +%s).sql.gz"
if [[ "$SRC" == s3://* ]]; then
  echo "==> Downloading $SRC"
  aws s3 cp "$SRC" "$TMP"
else
  cp "$SRC" "$TMP"
fi

echo "==> Restoring into RDS (this loads the dump as-is)"
gunzip -c "$TMP" | psql "$DATABASE_URL"
rm -f "$TMP"

echo "==> Applying any newer migrations"
( cd frontend && DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy )

echo "==> Done. Flip DATABASE_URL in frontend/.env.production and redeploy:"
echo "    docker compose up -d --build app"
