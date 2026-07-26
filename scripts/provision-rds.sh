#!/usr/bin/env bash
# Provision managed Postgres on AWS RDS for KindCaddy — idempotent.
#
# Replaces the self-hosted Postgres container. Safe to re-run: every step
# checks for the resource first and only creates what's missing. Requires the
# AWS CLI configured with credentials that can manage RDS + EC2 security groups.
#
# Usage (fill the two required VPC values, then run):
#   APP_SG_ID=sg-0appserver DB_SUBNET_IDS="subnet-a,subnet-b" \
#   DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=')" \
#   ./scripts/provision-rds.sh
#
# On success it prints the RDS endpoint and the exact DATABASE_URL to paste into
# frontend/.env.production. Provisioning takes ~5-10 min; the script waits.
#
# Launch default is single-AZ (MULTI_AZ=false) to keep cost down. Flip to
# Multi-AZ later with: MULTI_AZ=true ./scripts/provision-rds.sh  (idempotent
# re-run modifies the existing instance — or use `aws rds modify-db-instance
# --db-instance-identifier kindcaddy-prod --multi-az --apply-immediately`).
set -euo pipefail

# Pick up shared deploy settings (AWS_REGION, DB_PASSWORD) from the deploy
# credentials file when present — same source deploy-ec2.sh uses. Values are
# never printed; inline env vars still override.
if [ -f "$HOME/.kindcaddy-deploy/credentials.env" ]; then
  set -a; . "$HOME/.kindcaddy-deploy/credentials.env"; set +a
fi

# --- Config (override via env) ---
AWS_REGION="${AWS_REGION:-us-east-1}"
DB_INSTANCE_ID="${DB_INSTANCE_ID:-kindcaddy-prod}"
DB_NAME="${DB_NAME:-kindcaddy}"
DB_USER="${DB_USER:-kindcaddy}"
DB_INSTANCE_CLASS="${DB_INSTANCE_CLASS:-db.t3.micro}"
DB_ENGINE_VERSION="${DB_ENGINE_VERSION:-16}"
DB_ALLOCATED_STORAGE="${DB_ALLOCATED_STORAGE:-20}"
DB_MAX_STORAGE="${DB_MAX_STORAGE:-100}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
MULTI_AZ="${MULTI_AZ:-false}"           # single-AZ for launch; set true once user load justifies the ~2x DB cost
DB_SG_NAME="${DB_SG_NAME:-kindcaddy-rds-sg}"
DB_SUBNET_GROUP="${DB_SUBNET_GROUP:-kindcaddy-db-subnets}"

# --- Required inputs ---
: "${APP_SG_ID:?Set APP_SG_ID to the security group of the EC2 app instance}"
: "${DB_SUBNET_IDS:?Set DB_SUBNET_IDS to two comma-separated private subnet ids in different AZs}"
: "${DB_PASSWORD:?Set DB_PASSWORD to a strong master password}"

aws() { command aws --region "$AWS_REGION" "$@"; }

echo "==> Resolving VPC from app security group $APP_SG_ID"
VPC_ID=$(aws ec2 describe-security-groups --group-ids "$APP_SG_ID" \
  --query 'SecurityGroups[0].VpcId' --output text)
echo "    VPC: $VPC_ID"

echo "==> Ensuring DB security group ($DB_SG_NAME)"
DB_SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$DB_SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
if [ -z "$DB_SG_ID" ] || [ "$DB_SG_ID" = "None" ]; then
  DB_SG_ID=$(aws ec2 create-security-group --group-name "$DB_SG_NAME" \
    --description "KindCaddy RDS - Postgres from app only" --vpc-id "$VPC_ID" \
    --query 'GroupId' --output text)
  echo "    created $DB_SG_ID"
else
  echo "    exists $DB_SG_ID"
fi

echo "==> Ensuring ingress 5432 from app SG ($APP_SG_ID) only"
aws ec2 authorize-security-group-ingress --group-id "$DB_SG_ID" \
  --protocol tcp --port 5432 --source-group "$APP_SG_ID" 2>/dev/null \
  && echo "    rule added" || echo "    rule already present"

echo "==> Ensuring DB subnet group ($DB_SUBNET_GROUP)"
if ! aws rds describe-db-subnet-groups --db-subnet-group-name "$DB_SUBNET_GROUP" >/dev/null 2>&1; then
  IFS=',' read -ra SUBNETS <<< "$DB_SUBNET_IDS"
  aws rds create-db-subnet-group --db-subnet-group-name "$DB_SUBNET_GROUP" \
    --db-subnet-group-description "KindCaddy private DB subnets" \
    --subnet-ids "${SUBNETS[@]}" >/dev/null
  echo "    created"
else
  echo "    exists"
fi

echo "==> Ensuring RDS instance ($DB_INSTANCE_ID)"
if ! aws rds describe-db-instances --db-instance-identifier "$DB_INSTANCE_ID" >/dev/null 2>&1; then
  aws rds create-db-instance \
    --db-instance-identifier "$DB_INSTANCE_ID" \
    --db-name "$DB_NAME" \
    --engine postgres \
    --engine-version "$DB_ENGINE_VERSION" \
    --db-instance-class "$DB_INSTANCE_CLASS" \
    --allocated-storage "$DB_ALLOCATED_STORAGE" \
    --max-allocated-storage "$DB_MAX_STORAGE" \
    --storage-type gp3 \
    --master-username "$DB_USER" \
    --master-user-password "$DB_PASSWORD" \
    --vpc-security-group-ids "$DB_SG_ID" \
    --db-subnet-group-name "$DB_SUBNET_GROUP" \
    --backup-retention-period "$BACKUP_RETENTION_DAYS" \
    --storage-encrypted \
    --multi-az="$MULTI_AZ" \
    --no-publicly-accessible \
    --auto-minor-version-upgrade \
    --deletion-protection >/dev/null
  echo "    creating (this takes several minutes)"
else
  echo "    exists"
fi

echo "==> Waiting for instance to become available"
aws rds wait db-instance-available --db-instance-identifier "$DB_INSTANCE_ID"

ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier "$DB_INSTANCE_ID" \
  --query 'DBInstances[0].Endpoint.Address' --output text)

echo
echo "==> RDS ready: $ENDPOINT"
echo "    Paste this into frontend/.env.production (URL-encode the password if it has special chars):"
echo
echo "    DATABASE_URL=\"postgresql://$DB_USER:$DB_PASSWORD@$ENDPOINT:5432/$DB_NAME?sslmode=require\""
echo
echo "    Next: DATABASE_URL=... npx prisma migrate deploy   (from frontend/)"
echo "    Optional data import: scripts/restore-to-rds.sh <s3-dump-uri>"
