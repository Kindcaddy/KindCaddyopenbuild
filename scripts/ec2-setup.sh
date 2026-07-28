#!/usr/bin/env bash
# Run once on a fresh Ubuntu 24.04 EC2. Installs Docker, adds swap, clones repo.
# Postgres runs on managed RDS (scripts/provision-rds.sh) — no db container here.
# postgresql-client is installed for the secondary pg_dump backup + cutover restore.
set -euo pipefail
sudo apt-get update && sudo apt-get install -y ca-certificates curl git awscli postgresql-client
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# 4G swap — Next.js builds are memory-hungry on a t3.large
if [ ! -f /swapfile ]; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
git clone https://github.com/Kindcaddy/KindCaddyopenbuild.git ~/kindcaddy
# Hermes has been retired: the app calls an OpenAI-compatible provider (OpenRouter)
# directly, so there is no separate agent repo to clone here.
echo "DONE. Log out/in for docker group. Then:"
echo "  1) Provision the database: scripts/provision-rds.sh (see header for inputs)"
echo "  2) Put DATABASE_URL + OPENAI_* in frontend/.env.production"
echo "  3) cd frontend && DATABASE_URL=... npx prisma migrate deploy"
echo "  4) cd ~/kindcaddy && docker compose up -d"
