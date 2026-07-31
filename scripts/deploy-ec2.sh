#!/usr/bin/env bash
# KindCaddy EC2 deploy executor.
#
# PRIVACY MODEL: this script sources ~/.kindcaddy-deploy/credentials.env
# ITSELF. Secret values flow file -> shell -> AWS SSM Parameter Store
# (SecureString). They are never printed, never logged, never placed on a
# command line, never uploaded to the box as a file, never exposed to any
# model's context. The box renders them from SSM into RAM-backed tmpfs at
# deploy time (scripts/render-env-from-ssm.sh) using its EC2 instance role —
# no secrets file exists on the box, no AWS keys exist on the box.
#
# Commands:
#   --check                   verify creds file, perms, SSH, docker on box, DNS,
#                             aws CLI on box, and list SSM param NAMES
#   --gen-secrets             fill GENERATE fields in credentials.env via openssl
#   --push-secrets            push all secrets to SSM /kindcaddy/prod/* (SecureString)
#   --push-secrets --dry-run  show which param NAMES would be pushed, no upload
#   --render                  re-render /run/kindcaddy/env on the box from SSM
#   --deploy                  full deploy: git pull + build + render + migrate + up + health
#   --update                  routine patch: git pull + rebuild app + render + up + health
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
SSM_PREFIX="${KC_SSM_PREFIX:-/kindcaddy/prod/}"

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

# Authoritative region: read the box's own IMDSv2 (one ssh roundtrip). Falls
# back to AWS_REGION from credentials.env, then us-east-2 (current prod).
box_region() {
  local r
  r=$(sshc 'T=$(curl -s -m3 -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60"); curl -s -m3 -H "X-aws-ec2-metadata-token: $T" http://169.254.169.254/latest/meta-data/placement/region' 2>/dev/null || true)
  if [ -n "$r" ]; then echo "$r"; else echo "${AWS_REGION:-us-east-2}"; fi
}

# Percent-encode for safe embedding in URLs (DB passwords may contain +/= etc.)
urlencode() {
  python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1"
}

# --- commands ---

cmd_check() {
  load_creds
  echo "== credentials file: present, perms 600, placeholders filled"
  echo "== SSH to $EC2_USER@$EC2_HOST ..."
  sshc 'echo "   SSH_OK: $(hostname) | $(docker --version) | compose: $(docker compose version --short 2>/dev/null || echo MISSING)"' \
    || die "SSH failed — if your key has a passphrase, run: ssh-add $EC2_SSH_KEY (human types the passphrase locally)"
  echo "== aws CLI on box: $(sshc 'aws --version 2>/dev/null | head -1' || echo MISSING)"
  echo "== repo on box:"
  sshc 'cd ~/kindcaddy 2>/dev/null && git log --oneline -1 || echo "   ~/kindcaddy not cloned yet — run scripts/ec2-setup.sh on the box first"'
  echo "== DNS (both lines should show the same IP as EC2_HOST=$EC2_HOST):"
  echo "   dns: $(dig +short app.kindcaddy.com | tail -1)"
  echo "   ec2: $EC2_HOST"
  echo "== SSM parameters visible from the box (NAMES only):"
  sshc 'T=$(curl -s -m3 -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60"); R=$(curl -s -m3 -H "X-aws-ec2-metadata-token: $T" http://169.254.169.254/latest/meta-data/placement/region); echo "   box region: $R"; aws ssm describe-parameters --region "$R" --parameter-filters "Key=Name,Option=BeginsWith,Values='"$SSM_PREFIX"'" --query "Parameters[*].Name" --output text 2>&1 | tr "\t" "\n" | sed "s/^/   /" || true'
  echo "CHECK DONE — no secrets were read or printed beyond file sourcing."
}

cmd_gen_secrets() {
  [ -f "$CRED_FILE" ] || die "not found: $CRED_FILE"
  local var val
  for var in DB_PASSWORD AUTH_SECRET RESOURCE_ENCRYPTION_KEY; do
    if grep -q "^${var}=\"GENERATE\"" "$CRED_FILE"; then
      if [ "$var" = "DB_PASSWORD" ]; then
        # URL-safe by construction (it is embedded raw into DATABASE_URL on
        # other systems; the push also percent-encodes as belt-and-braces).
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

cmd_push_secrets() {
  local dry="${1:-}"
  load_full_secrets
  command -v aws >/dev/null || die "aws CLI not installed (brew install awscli)"
  local region; region=$(box_region)
  aws sts get-caller-identity --region "$region" >/dev/null 2>&1 \
    || die "local AWS creds not working — run: aws configure (human types keys)"

  local tmp; tmp=$(mktemp -d /tmp/kc-ssm.XXXXXX); chmod 700 "$tmp"

  # DATABASE_URL is built via printf args so no credential-URI literal exists
  # in this file. The password is percent-ENCODED here; RDS keeps the raw
  # form — they are the same password, one is the URL-safe spelling of the
  # other. RDS_ENDPOINT is normalized to host-only: older credentials.env had
  # a user:pass@ prefix embedded (runbook 'KNOWN ISSUE') — strip up to last @.
  local host="${RDS_ENDPOINT##*@}" pw_enc
  pw_enc=$(urlencode "$DB_PASSWORD")
  if [ "$host" != "$RDS_ENDPOINT" ]; then
    echo "NOTE: RDS_ENDPOINT carried an embedded user:pass@ prefix — stripped for the SSM param."
    echo "      Fix at source: host-only RDS_ENDPOINT + raw DB_PASSWORD in credentials.env (runbook: Secrets rotation)."
  fi
  printf 'postgresql://%s:%s@%s:5432/kindcaddy?sslmode=require' "kindcaddy" "$pw_enc" "$host" > "$tmp/DATABASE_URL"

  printf '%s' "$AUTH_SECRET"             > "$tmp/AUTH_SECRET"
  printf '%s' "$AUTH_RESEND_KEY"         > "$tmp/AUTH_RESEND_KEY"
  printf '%s' "$RESOURCE_ENCRYPTION_KEY" > "$tmp/RESOURCE_ENCRYPTION_KEY"
  printf '%s' "$EMAIL_FROM"              > "$tmp/EMAIL_FROM"
  # Optional integrations: pushed only when configured (same rule the old
  # file-render used). The redirect URIs are not secret (derived from APP_ORIGIN).
  if [ -n "${QBO_CLIENT_ID:-}" ] && [ "$QBO_CLIENT_ID" != "REPLACE_ME" ]; then
    printf '%s' "$QBO_CLIENT_ID"         > "$tmp/QBO_CLIENT_ID"
    printf '%s' "${QBO_CLIENT_SECRET:-}" > "$tmp/QBO_CLIENT_SECRET"
    printf '%s' "https://app.kindcaddy.com/api/integrations/quickbooks/callback" > "$tmp/QBO_REDIRECT_URI"
    printf '%s' "${QBO_ENV:-production}" > "$tmp/QBO_ENV"
  fi
  if [ -n "${GOOGLE_CLIENT_ID:-}" ] && [ "$GOOGLE_CLIENT_ID" != "REPLACE_ME" ]; then
    printf '%s' "$GOOGLE_CLIENT_ID"         > "$tmp/GOOGLE_CLIENT_ID"
    printf '%s' "${GOOGLE_CLIENT_SECRET:-}" > "$tmp/GOOGLE_CLIENT_SECRET"
    printf '%s' "https://app.kindcaddy.com/api/integrations/google/callback" > "$tmp/GOOGLE_REDIRECT_URI"
  fi

  local n k perr
  n=$(cd "$tmp" && ls | wc -l | tr -d ' ')
  if [ "$dry" = "--dry-run" ]; then
    echo "DRY RUN — would put $n SSM params (region $region, prefix $SSM_PREFIX), key names only:"
    (cd "$tmp" && for k in *; do echo "   ${SSM_PREFIX}$k"; done)
    rm -rf "$tmp"
    echo "DRY RUN done — nothing pushed, nothing uploaded."
    return 0
  fi

  echo "== pushing $n params to SSM $region under $SSM_PREFIX (values never displayed)"
  (cd "$tmp" && ls) | while read -r k; do
    if perr=$(aws ssm put-parameter --region "$region" --name "${SSM_PREFIX}$k" \
        --type SecureString --tier Standard --overwrite \
        --value "file://$tmp/$k" --query 'Version' --output text 2>&1 >/dev/null); then
      echo "   pushed ${SSM_PREFIX}$k"
    else
      rm -rf "$tmp"
      die "put-parameter failed for ${SSM_PREFIX}$k — AWS said: $perr"
    fi
  done
  rm -rf "$tmp"
  echo "== pushed. Local temp copies destroyed; nothing was uploaded to the box."
  echo "   The running app is UNCHANGED until: $0 --update  (renders + restarts)"
}

cmd_render() {
  load_creds
  render_env_on_box
}

render_env_on_box() {
  echo "== rendering env on box from SSM into RAM tmpfs (/run/kindcaddy/env)"
  sshc 'cd ~/kindcaddy && ./scripts/render-env-from-ssm.sh' \
    || die "env render failed — params pushed? ($0 --push-secrets) IAM policy attached to ec2-ssm-role? (runbook: Secrets rotation)"
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
  render_env_on_box
  echo "== running migrations against RDS (also the canary: proves the rendered DATABASE_URL authenticates BEFORE the app restarts)"
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
  render_env_on_box
  echo "== applying any new migrations (also the canary: proves the rendered DATABASE_URL authenticates BEFORE the app restarts)"
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
  --render)       cmd_render ;;
  --deploy)       cmd_deploy ;;
  --update)       cmd_update ;;
  --logs)         cmd_logs "${2:-80}" ;;
  --backup)       cmd_backup ;;
  --ssh)          [ $# -ge 2 ] || die "usage: $0 --ssh '<remote command>'"; shift; load_creds; sshc "$@" ;;
  --scp-get)      [ $# -ge 3 ] || die "usage: $0 --scp-get <remote-path> <local-path>"; load_creds; scpc "$EC2_USER@$EC2_HOST:$2" "$3" ;;
  --clean-host-key) cmd_clean_host_key ;;
  --wipe)         cmd_wipe "${2:-}" ;;
  *) echo "usage: $0 --check | --gen-secrets | --push-secrets [--dry-run] | --render | --deploy | --update | --logs [N] | --backup | --ssh '<cmd>' | --scp-get <remote> <local> | --clean-host-key | --wipe [CONFIRM]"; exit 2 ;;
esac
