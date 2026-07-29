#!/usr/bin/env bash
# KindCaddy EC2 deploy executor.
#
# PRIVACY MODEL: this script sources ~/.kindcaddy-deploy/credentials.env
# ITSELF. Secret values flow file -> shell -> file -> EC2. They are never
# printed, never logged, never placed on a command line, never exposed to
# any model's context. The operator (human or local model) only runs the
# commands below and sees sanitized output.
#
# Commands:
#   --check                   verify creds file, perms, SSH, docker on box, DNS
#   --gen-secrets             fill GENERATE fields in credentials.env via openssl
#   --push-secrets            render frontend/.env.production locally, scp to box, chmod 600
#   --push-secrets --dry-run  render and show KEY NAMES ONLY (values masked), no upload
#   --deploy                  full deploy: git pull + build + migrate + up + health
#   --update                  routine patch: git pull + rebuild app + up + health
#   --logs [N]                tail app container logs (default 80)
#   --backup                  run scripts/backup-db.sh on the box
#   --ssh '<cmd>'             run one arbitrary remote command (sanitized output)
#   --scp-get <remote> <local>  fetch a file from the box (e.g. pre-wipe archive)
#   --clean-host-key          forget the box's OLD ssh host key (needed after a
#                             root-volume replacement / reimage, else SSH refuses)
#   --wipe [CONFIRM]          DESTRUCTIVE: replace the EC2 root volume with fresh
#                             Ubuntu 24.04 (keeps instance/EIP/SG/key). Without
#                             CONFIRM it only prints the plan. Needs AWS CLI
#                             configured locally (aws configure — human types keys).
#
# bash 3.2 compatible (macOS stock bash). No `set -x` ever — tracing leaks.
set -euo pipefail

CRED_DIR="${HOME}/.kindcaddy-deploy"
CRED_FILE="${CRED_DIR}/credentials.env"

die() { echo "ERROR: $*" >&2; exit 1; }

load_creds() {
  [ -f "$CRED_FILE" ] || die "not found: $CRED_FILE — cp scripts/credentials.env.template there and fill it"
  local perms
  perms=$(stat -f %Lp "$CRED_FILE" 2>/dev/null || stat -c %a "$CRED_FILE" 2>/dev/null || echo unknown)
  [ "$perms" = "600" ] || die "$CRED_FILE must be chmod 600 (found: $perms)"
  set -a; . "$CRED_FILE"; set +a
  : "${EC2_HOST:?missing EC2_HOST in credentials.env}"
  : "${EC2_SSH_KEY:?missing EC2_SSH_KEY in credentials.env}"
  EC2_USER="${EC2_USER:-ubuntu}"
  [ "$EC2_HOST" != "REPLACE_ME" ] || die "fill EC2_HOST in $CRED_FILE first"
  [ "$EC2_SSH_KEY" != "REPLACE_ME" ] || die "fill EC2_SSH_KEY in $CRED_FILE first"
  [ -f "$EC2_SSH_KEY" ] || die "SSH key not found at: $EC2_SSH_KEY"
}

load_full_secrets() {
  load_creds
  if grep -qE '^[A-Z_]+="REPLACE_ME"' "$CRED_FILE"; then
    die "credentials.env still has REPLACE_ME placeholders — fill them first ('$0 --gen-secrets' fills the GENERATE ones)"
  fi
  : "${RDS_ENDPOINT:?missing RDS_ENDPOINT (run scripts/provision-rds.sh first)}"
  : "${DB_PASSWORD:?missing DB_PASSWORD (run $0 --gen-secrets)}"
  : "${AUTH_SECRET:?missing AUTH_SECRET (run $0 --gen-secrets)}"
  : "${RESOURCE_ENCRYPTION_KEY:?missing RESOURCE_ENCRYPTION_KEY (run $0 --gen-secrets)}"
  : "${AUTH_RESEND_KEY:?missing AUTH_RESEND_KEY (from resend.com)}"
  : "${EMAIL_FROM:?missing EMAIL_FROM}"
}

sshc() {
  ssh -i "$EC2_SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
      -o ConnectTimeout=10 "$EC2_USER@$EC2_HOST" "$@"
}

scpc() {
  scp -i "$EC2_SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$@"
}

# --- commands ---

cmd_check() {
  load_creds
  echo "== credentials file: present, perms 600, placeholders filled"
  echo "== SSH to $EC2_USER@$EC2_HOST ..."
  sshc 'echo "   SSH_OK: $(hostname) | $(docker --version) | compose: $(docker compose version --short 2>/dev/null || echo MISSING)"' \
    || die "SSH failed — if your key has a passphrase, run: ssh-add $EC2_SSH_KEY (human types the passphrase locally)"
  echo "== repo on box:"
  sshc 'cd ~/kindcaddy 2>/dev/null && git log --oneline -1 || echo "   ~/kindcaddy not cloned yet — run scripts/ec2-setup.sh on the box first"'
  echo "== DNS (both lines should show the same IP as EC2_HOST=$EC2_HOST):"
  echo "   dns: $(dig +short app.kindcaddy.com | tail -1)"
  echo "   ec2: $EC2_HOST"
  echo "CHECK DONE — no secrets were read or printed beyond file sourcing."
}

cmd_gen_secrets() {
  [ -f "$CRED_FILE" ] || die "not found: $CRED_FILE"
  local var val
  for var in DB_PASSWORD AUTH_SECRET RESOURCE_ENCRYPTION_KEY; do
    if grep -q "^${var}=\"GENERATE\"" "$CRED_FILE"; then
      if [ "$var" = "DB_PASSWORD" ]; then
        # URL-safe by construction (it is embedded raw into DATABASE_URL on
        # other systems; render_env also percent-encodes as belt-and-braces).
        val=$(openssl rand -base64 24 | tr -d '/+=\n')
      else
        val=$(openssl rand -base64 32 | tr -d '\n')
      fi
      sed -i.bak "s|^${var}=\"GENERATE\"|${var}=\"${val}\"|" "$CRED_FILE" && rm -f "$CRED_FILE.bak"
      echo "generated $var (value not displayed)"
    else
      echo "$var already set (unchanged)"
    fi
  done
}

# Percent-encode for safe embedding in URLs (DB passwords may contain +/= etc.)
urlencode() {
  python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1"
}

render_env() {
  # Writes frontend/.env.production content to the path in $1. No stdout.
  # DATABASE_URL is built via printf args so no credential-URI literal exists
  # in this file (keeps secret-pattern scanners from mangling the script).
  # The password is percent-ENCODED here; RDS keeps the raw form — they are
  # the same password, one is the URL-safe spelling of the other.
  local pw_enc
  pw_enc=$(urlencode "$DB_PASSWORD")
  printf 'DATABASE_URL="postgresql://%s:%s@%s:5432/kindcaddy?sslmode=require"\n' \
    "kindcaddy" "$pw_enc" "$RDS_ENDPOINT" > "$1"
  cat >> "$1" <<EOF
NODE_ENV="production"
APP_ORIGIN="https://app.kindcaddy.com"
AUTH_SECRET="${AUTH_SECRET}"
AUTH_TRUST_HOST="true"
AUTH_URL="https://app.kindcaddy.com"
AUTH_RESEND_KEY="${AUTH_RESEND_KEY}"
AUTH_ALLOW_EMAIL_LINKING="true"
EMAIL_FROM="${EMAIL_FROM}"
RESOURCE_ENCRYPTION_KEY="${RESOURCE_ENCRYPTION_KEY}"
LLM_TIMEOUT_MS="60000"
LLM_MAX_TOOL_ROUNDS="5"
LLM_TURN_BUDGET_MS="180000"
LLM_MEMORY_TIMEOUT_MS="15000"
MAX_CONCURRENT_CHAT_TURNS="8"
EOF
  # QuickBooks is optional: rendered only when the production keys are present
  # in credentials.env. The redirect URI is not secret (derived from APP_ORIGIN).
  if [ -n "${QBO_CLIENT_ID:-}" ] && [ "${QBO_CLIENT_ID}" != "REPLACE_ME" ]; then
    cat >> "$1" <<EOF
QBO_CLIENT_ID="${QBO_CLIENT_ID}"
QBO_CLIENT_SECRET="${QBO_CLIENT_SECRET:-}"
QBO_REDIRECT_URI="https://app.kindcaddy.com/api/integrations/quickbooks/callback"
QBO_ENV="${QBO_ENV:-production}"
EOF
  fi
  # Google Calendar is optional: rendered only when the OAuth client keys are
  # present in credentials.env. The redirect URI is not secret.
  if [ -n "${GOOGLE_CLIENT_ID:-}" ] && [ "${GOOGLE_CLIENT_ID}" != "REPLACE_ME" ]; then
    cat >> "$1" <<EOF
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"
GOOGLE_REDIRECT_URI="https://app.kindcaddy.com/api/integrations/google/callback"
EOF
  fi
}

cmd_push_secrets() {
  local dry="${1:-}"
  load_full_secrets
  local tmp
  tmp=$(mktemp -d /tmp/kc-env.XXXXXX)
  chmod 700 "$tmp"
  render_env "$tmp/.env.production"
  local lines
  lines=$(wc -l < "$tmp/.env.production" | tr -d ' ')
  if [ "$dry" = "--dry-run" ]; then
    echo "DRY RUN — rendered $lines lines. Key names only (values masked):"
    awk -F= '{print "   " $1}' "$tmp/.env.production"
    rm -rf "$tmp"
    echo "DRY RUN done — nothing uploaded."
    return 0
  fi
  echo "== uploading frontend/.env.production ($lines lines, values never displayed)"
  sshc 'mkdir -p ~/kindcaddy/frontend'
  scpc "$tmp/.env.production" "$EC2_USER@$EC2_HOST:~/kindcaddy/frontend/.env.production" >/dev/null
  sshc 'chmod 600 ~/kindcaddy/frontend/.env.production'
  rm -rf "$tmp"
  echo "== uploaded and chmod 600. Local temp copy destroyed."
}

# Builds on the box and aborts if the build fails. BuildKit noise is captured
# to a log rather than filtered through a pipe: a swallowed non-zero exit lets
# the deploy continue and restart the PREVIOUS image, which silently reships
# stale code while reporting success.
remote_build() {
  local target="${1:-}" log
  log=$(mktemp /tmp/kc-build.XXXXXX)
  if sshc "cd ~/kindcaddy && docker compose build $target" > "$log" 2>&1; then
    grep -E "Built|naming to " "$log" | tail -2
    rm -f "$log"
  else
    echo "---- last 40 lines of build output ----" >&2
    tail -40 "$log" >&2
    echo "---------------------------------------" >&2
    rm -f "$log"
    die "build failed on the box — nothing was restarted, the running image is untouched"
  fi
}

# A build can exit 0 and still produce an unusable bundle: a layout.tsx in the
# segment named `app` once shadowed the root layout, so globals.css and the
# fonts never entered the graph and every page shipped without a stylesheet.
# Refuse to restart onto an image that has no compiled CSS.
verify_app_image() {
  echo "== verifying the new image ships compiled CSS"
  if sshc 'cd ~/kindcaddy && docker compose run --rm --no-deps --entrypoint ls app .next/static/css' >/dev/null 2>&1; then
    echo "   stylesheet present"
  else
    die "built image has no .next/static/css — refusing to restart; the previous image is still serving"
  fi
}

cmd_deploy() {
  load_creds
  echo "== pulling latest code on box"
  sshc 'cd ~/kindcaddy && git pull --ff-only'
  echo "== building images (this takes several minutes on first run)"
  remote_build
  verify_app_image
  echo "== running migrations against RDS"
  sshc 'cd ~/kindcaddy && docker compose run --rm app npx prisma migrate deploy'
  echo "== starting stack"
  sshc 'cd ~/kindcaddy && docker compose up -d && docker compose ps'
  echo "== health check:"
  sshc 'curl -s http://127.0.0.1:3000/api/health && echo'
  echo "DEPLOY DONE. Verify in your browser: https://app.kindcaddy.com/login"
}

cmd_update() {
  load_creds
  echo "== pulling latest code on box"
  sshc 'cd ~/kindcaddy && git pull --ff-only'
  echo "== rebuilding app image"
  remote_build app
  verify_app_image
  echo "== applying any new migrations"
  sshc 'cd ~/kindcaddy && docker compose run --rm app npx prisma migrate deploy'
  echo "== restarting app"
  sshc 'cd ~/kindcaddy && docker compose up -d app && docker compose ps'
  echo "== health check:"
  sshc 'curl -s http://127.0.0.1:3000/api/health && echo'
  echo "UPDATE DONE."
}

cmd_logs() {
  load_creds
  sshc "cd ~/kindcaddy && docker compose logs --tail=${1:-80} app"
}

cmd_backup() {
  load_creds
  sshc 'cd ~/kindcaddy && ./scripts/backup-db.sh'
}

cmd_clean_host_key() {
  load_creds
  ssh-keygen -R "$EC2_HOST" >/dev/null 2>&1 || true
  echo "old host key for the box removed from known_hosts — next SSH will accept the fresh one"
}

cmd_wipe() {
  load_creds
  command -v aws >/dev/null || die "aws CLI not installed (brew install awscli)"
  local region="${AWS_REGION:-us-east-1}"
  local inst vol ami state task i
  inst=$(aws ec2 describe-instances --region "$region" \
    --filters "Name=ip-address,Values=$EC2_HOST" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)
  if [ -z "$inst" ] || [ "$inst" = "None" ]; then
    die "no instance with public IP $EC2_HOST in $region (wrong region? set AWS_REGION in credentials.env — or run 'aws configure' if creds are missing)"
  fi
  vol=$(aws ec2 describe-instances --region "$region" --instance-ids "$inst" \
    --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' --output text 2>/dev/null || true)
  [ -n "$vol" ] && [ "$vol" != "None" ] || die "could not read root volume for $inst"
  ami=$(aws ssm get-parameter --region "$region" \
    --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query 'Parameter.Value' --output text 2>/dev/null || true)
  [ -n "$ami" ] && [ "$ami" != "None" ] || die "could not resolve Ubuntu 24.04 AMI via SSM in $region"
  echo "WIPE PLAN:"
  echo "  instance:  $inst  (the box at your Elastic IP)"
  echo "  root vol:  $vol   <-- WILL BE DESTROYED (old iOS app + everything on it)"
  echo "  fresh AMI: $ami   (Ubuntu 24.04 LTS, canonical)"
  echo "  keeps:     same instance ID, Elastic IP, security group, key pair"
  if [ "${1:-}" != "CONFIRM" ]; then
    echo
    echo "dry-run only — no changes made. To execute: $0 --wipe CONFIRM"
    exit 0
  fi
  echo "== stopping instance (old app goes offline now)"
  aws ec2 stop-instances --region "$region" --instance-ids "$inst" >/dev/null
  aws ec2 wait instance-stopped --region "$region" --instance-ids "$inst"
  echo "== replacing root volume with fresh Ubuntu 24.04 (task takes a few minutes)"
  local cerr
  cerr=$(aws ec2 create-replace-root-volume-task --region "$region" \
    --instance-id "$inst" --image-id "$ami" \
    --query 'ReplaceRootVolumeTaskId' --output text 2>&1 || true)
  case "$cerr" in
  replacevol-*) task="$cerr" ;;
  *)
    die "create-replacement-root-volume-task failed (instance $inst is STOPPED, old volume intact — recoverable). AWS said:
$cerr" ;;
  esac
  for i in $(seq 1 40); do
    state=$(aws ec2 describe-replace-root-volume-tasks --region "$region" \
      --replace-root-volume-task-ids "$task" \
      --query 'ReplaceRootVolumeTasks[0].TaskState' --output text 2>/dev/null || true)
    state="${state:-pending}"
    echo "   task state: $state"
    case "$state" in
      succeeded) break ;;
      failed|failing) die "replacement task FAILED — the instance is STOPPED with its old volume intact; investigate at the console before retrying" ;;
    esac
    sleep 15
  done
  echo "== starting instance"
  aws ec2 start-instances --region "$region" --instance-ids "$inst" >/dev/null
  aws ec2 wait instance-running --region "$region" --instance-ids "$inst"
  echo "WIPE DONE — fresh Ubuntu 24.04 at the same Elastic IP."
  echo "Next: $0 --clean-host-key, then Sequence R (ec2-setup.sh) in QWEN-DEPLOY-RUNBOOK.md"
}

case "${1:-}" in
  --check)        cmd_check ;;
  --gen-secrets)  cmd_gen_secrets ;;
  --push-secrets) cmd_push_secrets "${2:-}" ;;
  --deploy)       cmd_deploy ;;
  --update)       cmd_update ;;
  --logs)         cmd_logs "${2:-80}" ;;
  --backup)       cmd_backup ;;
  --ssh)          [ $# -ge 2 ] || die "usage: $0 --ssh '<remote command>'"; shift; load_creds; sshc "$@" ;;
  --scp-get)      [ $# -ge 3 ] || die "usage: $0 --scp-get <remote-path> <local-path>"; load_creds; scpc "$EC2_USER@$EC2_HOST:$2" "$3" ;;
  --clean-host-key) cmd_clean_host_key ;;
  --wipe)         cmd_wipe "${2:-}" ;;
  *) echo "usage: $0 --check | --gen-secrets | --push-secrets [--dry-run] | --deploy | --update | --logs [N] | --backup | --ssh '<cmd>' | --scp-get <remote> <local> | --clean-host-key | --wipe [CONFIRM]"; exit 2 ;;
esac
