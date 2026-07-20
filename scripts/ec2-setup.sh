#!/usr/bin/env bash
# Run once on a fresh Ubuntu 24.04 EC2. Installs Docker, adds swap, clones repo.
set -euo pipefail
sudo apt-get update && sudo apt-get install -y ca-certificates curl git awscli
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# 4G swap — Next.js builds are memory-hungry on a t3.large
if [ ! -f /swapfile ]; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
git clone https://github.com/Kindcaddy/Kindcaddycustomize.git ~/kindcaddy
# Hermes is a separate open-source repo (not inside the KindCaddy repo).
# Clone it into the compose build context, pinned to the commit validated locally.
git clone https://github.com/NousResearch/hermes-agent.git ~/kindcaddy/hermes-agent
git -C ~/kindcaddy/hermes-agent checkout 6f1eed3968318dc1d6ca3fb3ded2de6fc8e50308 || \
  echo "WARN: pinned Hermes commit not found on remote; staying on default branch — verify manually"
echo "DONE. Log out/in for docker group, place env files, then: cd ~/kindcaddy && docker compose up -d"
