#!/usr/bin/env bash
# KindCaddy PROD (app.kindcaddy.com): render the app's env file from AWS SSM
# Parameter Store into RAM-backed tmpfs (/run/kindcaddy/env). No secrets are
# ever written to disk on the box. Auth comes from the EC2 instance role —
# no AWS keys exist on the box.
#
# Params live at /kindcaddy/prod/<KEY> (SecureString, standard tier = free).
# Push/rotate them from the operator laptop: scripts/deploy-ec2.sh --push-secrets
#
# Run this before any `docker compose up|run` (the deploy runner does it).
# Idempotent. Self-hosters without AWS: skip this script and use
# frontend/.env.production instead (see frontend/.env.production.example) —
# docker-compose.yml loads whichever source exists, SSM render wins if both.
set -euo pipefail

PREFIX="${KC_SSM_PREFIX:-/kindcaddy/prod/}"
OUT_DIR="/run/kindcaddy"
OUT="$OUT_DIR/env"

REQUIRED="DATABASE_URL AUTH_SECRET AUTH_RESEND_KEY RESOURCE_ENCRYPTION_KEY EMAIL_FROM"
OPTIONAL="QBO_CLIENT_ID QBO_CLIENT_SECRET QBO_REDIRECT_URI QBO_ENV GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI"

# Region from IMDSv2 — nothing hardcoded; works in any region/account.
TOKEN=$(curl -s -m 3 -X PUT http://169.254.169.254/latest/api/token \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
REGION=$(curl -s -m 3 -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/placement/region)
[ -n "$REGION" ] || { echo "ERROR: IMDS region lookup failed (not on EC2? IMDSv2 blocked?)" >&2; exit 1; }

fetch() { # $1=key; stdout=value (empty on miss). Errors never carry values.
  aws ssm get-parameter --region "$REGION" --name "${PREFIX}$1" \
    --with-decryption --query 'Parameter.Value' --output text 2>/dev/null || true
}

# /run is root-owned; create our tmpfs dir via the box's passwordless sudo
# (idempotent; /run is cleared on reboot so this re-runs every render).
if [ ! -d "$OUT_DIR" ]; then
  sudo -n install -d -m 700 -o "$(id -un)" "$OUT_DIR" \
    || { echo "ERROR: cannot create $OUT_DIR (passwordless sudo missing?)" >&2; exit 1; }
fi
chmod 700 "$OUT_DIR"
OUT_TMP=$(mktemp "$OUT_DIR/.env.XXXXXX")   # /run is tmpfs — never touches disk
chmod 600 "$OUT_TMP"

emit() { # $1=key $2=value — guard against chars the dotenv format can't carry
  case "$2" in
    *'"'*|*'$'*|*'`'*)
      echo "ERROR: ${PREFIX}$1 contains a quote/dollar/backtick the env_file format cannot carry safely" >&2
      return 1 ;;
  esac
  printf '%s="%s"\n' "$1" "$2" >> "$OUT_TMP"
}

fail=0
for k in $REQUIRED; do
  v=$(fetch "$k")
  if [ -z "$v" ]; then
    echo "ERROR: missing required parameter ${PREFIX}$k in $REGION" >&2; fail=1
  else
    emit "$k" "$v" || fail=1
  fi
done
if [ "$fail" -ne 0 ]; then
  rm -f "$OUT_TMP"
  echo "Fix: push params from the laptop — scripts/deploy-ec2.sh --push-secrets" >&2
  exit 1
fi

for k in $OPTIONAL; do
  v=$(fetch "$k")
  [ -n "$v" ] && { emit "$k" "$v" || { rm -f "$OUT_TMP"; exit 1; }; } || true
done

# Non-secret production config (public values). Kept in this script so that
# NO env file needs to exist on disk; secrets come only from SSM above.
cat >> "$OUT_TMP" <<'EOF'
NODE_ENV="production"
APP_ORIGIN="https://app.kindcaddy.com"
AUTH_TRUST_HOST="true"
AUTH_URL="https://app.kindcaddy.com"
AUTH_ALLOW_EMAIL_LINKING="true"
LLM_TIMEOUT_MS="60000"
LLM_MAX_TOOL_ROUNDS="5"
LLM_TURN_BUDGET_MS="180000"
LLM_MEMORY_TIMEOUT_MS="15000"
MAX_CONCURRENT_CHAT_TURNS="8"
EOF

mv "$OUT_TMP" "$OUT"; chmod 600 "$OUT"
echo "rendered $OUT ($(wc -l < "$OUT" | tr -d ' ') lines from ${PREFIX}* in $REGION; values never displayed)"
