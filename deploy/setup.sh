#!/usr/bin/env bash
# =============================================================================
# PACE — First-Time AWS Lightsail Deployment Script
# =============================================================================
# Provisions a fresh Lightsail instance in ap-south-1 (Mumbai), installs
# Docker + Docker Compose, clones the repo, and starts all services.
#
# Prerequisites:
#   - AWS CLI v2 installed and configured (aws configure)
#   - SSH key pair created in Lightsail console for ap-south-1
#   - A .env file ready to copy to the instance
#
# Usage:
#   chmod +x deploy/setup.sh
#   ./deploy/setup.sh
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — edit these before running
# ---------------------------------------------------------------------------
INSTANCE_NAME="${INSTANCE_NAME:-pace-server}"
REGION="${REGION:-ap-south-1}"
AVAILABILITY_ZONE="${AVAILABILITY_ZONE:-ap-south-1a}"
BLUEPRINT_ID="${BLUEPRINT_ID:-ubuntu_22_04}"
BUNDLE_ID="${BUNDLE_ID:-medium_3_0}"          # $10/mo plan, 2GB RAM, 60GB SSD
KEY_PAIR_NAME="${KEY_PAIR_NAME:-pace-lightsail-key}"
SSH_KEY_PATH="${SSH_KEY_PATH:-~/.ssh/pace-lightsail-key.pem}"
REPO_URL="${REPO_URL:-git@github.com:your-org/pace.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
ENV_FILE_PATH="${ENV_FILE_PATH:-./.env}"
REMOTE_USER="${REMOTE_USER:-ubuntu}"
APP_DIR="/home/${REMOTE_USER}/pace"

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

wait_for_instance() {
  log "Waiting for instance to be running..."
  local retries=0
  while true; do
    local state
    state=$(aws lightsail get-instance \
      --instance-name "$INSTANCE_NAME" \
      --region "$REGION" \
      --query 'instance.state.name' \
      --output text 2>/dev/null || echo "unknown")

    if [[ "$state" == "running" ]]; then
      log "Instance is running."
      break
    fi

    retries=$((retries + 1))
    if [[ $retries -ge 60 ]]; then
      fail "Instance did not reach 'running' state after 5 minutes."
    fi
    sleep 5
  done
}

get_instance_ip() {
  aws lightsail get-instance \
    --instance-name "$INSTANCE_NAME" \
    --region "$REGION" \
    --query 'instance.publicIpAddress' \
    --output text
}

remote_exec() {
  ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
    -i "$SSH_KEY_PATH" "${REMOTE_USER}@${INSTANCE_IP}" "$@"
}

# ---------------------------------------------------------------------------
# Step 1: Create Lightsail instance (idempotent — skips if exists)
# ---------------------------------------------------------------------------
log "Checking if instance '${INSTANCE_NAME}' already exists..."
if aws lightsail get-instance --instance-name "$INSTANCE_NAME" --region "$REGION" &>/dev/null; then
  log "Instance '${INSTANCE_NAME}' already exists, skipping creation."
else
  log "Creating Lightsail instance '${INSTANCE_NAME}' in ${REGION}..."
  aws lightsail create-instances \
    --instance-names "$INSTANCE_NAME" \
    --availability-zone "$AVAILABILITY_ZONE" \
    --blueprint-id "$BLUEPRINT_ID" \
    --bundle-id "$BUNDLE_ID" \
    --key-pair-name "$KEY_PAIR_NAME" \
    --region "$REGION" \
    --tags "key=app,value=pace" "key=env,value=production"

  log "Instance creation initiated."
fi

# ---------------------------------------------------------------------------
# Step 2: Wait for instance and get IP
# ---------------------------------------------------------------------------
wait_for_instance
INSTANCE_IP=$(get_instance_ip)
log "Instance IP: ${INSTANCE_IP}"

# ---------------------------------------------------------------------------
# Step 3: Open firewall ports (idempotent)
# ---------------------------------------------------------------------------
log "Opening firewall ports 22, 80, 443..."
aws lightsail open-instance-public-ports \
  --instance-name "$INSTANCE_NAME" \
  --region "$REGION" \
  --port-info fromPort=22,toPort=22,protocol=tcp

aws lightsail open-instance-public-ports \
  --instance-name "$INSTANCE_NAME" \
  --region "$REGION" \
  --port-info fromPort=80,toPort=80,protocol=tcp

aws lightsail open-instance-public-ports \
  --instance-name "$INSTANCE_NAME" \
  --region "$REGION" \
  --port-info fromPort=443,toPort=443,protocol=tcp

log "Firewall ports opened."

# ---------------------------------------------------------------------------
# Step 4: Wait for SSH to become available
# ---------------------------------------------------------------------------
log "Waiting for SSH to become available..."
retries=0
while ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
  -i "$SSH_KEY_PATH" "${REMOTE_USER}@${INSTANCE_IP}" "echo ok" &>/dev/null; do
  retries=$((retries + 1))
  if [[ $retries -ge 30 ]]; then
    fail "SSH not available after 2.5 minutes."
  fi
  sleep 5
done
log "SSH is available."

# ---------------------------------------------------------------------------
# Step 5: Install Docker and Docker Compose on the instance
# ---------------------------------------------------------------------------
log "Installing Docker and Docker Compose..."
remote_exec bash -s <<'INSTALL_DOCKER'
set -euo pipefail

# Skip if Docker is already installed
if command -v docker &>/dev/null; then
  echo "Docker already installed: $(docker --version)"
else
  # Install prerequisites
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl gnupg lsb-release

  # Add Docker GPG key and repository
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  # Install Docker Engine + Compose plugin
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

  # Allow current user to run Docker without sudo
  sudo usermod -aG docker "$USER"

  echo "Docker installed: $(docker --version)"
  echo "Docker Compose installed: $(docker compose version)"
fi
INSTALL_DOCKER

log "Docker installation complete."

# ---------------------------------------------------------------------------
# Step 6: Clone repo and set up application
# ---------------------------------------------------------------------------
log "Setting up application on instance..."
remote_exec bash -s <<SETUP_APP
set -euo pipefail

# Clone or update the repository
if [ -d "${APP_DIR}" ]; then
  echo "Repository already exists, pulling latest..."
  cd "${APP_DIR}"
  git fetch origin
  git checkout "${REPO_BRANCH}"
  git pull origin "${REPO_BRANCH}"
else
  echo "Cloning repository..."
  git clone --branch "${REPO_BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"

# Create pb_data directory for PocketBase volume
mkdir -p pb_data
SETUP_APP

log "Repository cloned."

# ---------------------------------------------------------------------------
# Step 7: Copy .env file to the instance
# ---------------------------------------------------------------------------
if [[ -f "$ENV_FILE_PATH" ]]; then
  log "Copying .env file to instance..."
  scp -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" \
    "$ENV_FILE_PATH" "${REMOTE_USER}@${INSTANCE_IP}:${APP_DIR}/.env"
  log ".env file copied."
else
  log "WARNING: No .env file found at '${ENV_FILE_PATH}'. Copy it manually before starting services."
  log "  scp -i ${SSH_KEY_PATH} .env ${REMOTE_USER}@${INSTANCE_IP}:${APP_DIR}/.env"
fi

# ---------------------------------------------------------------------------
# Step 8: Start services with Docker Compose
# ---------------------------------------------------------------------------
log "Starting services with Docker Compose..."
remote_exec bash -s <<START_SERVICES
set -euo pipefail
cd "${APP_DIR}"

# Use newgrp to pick up docker group without re-login
sg docker -c "docker compose up -d --build"

echo ""
echo "Running containers:"
sg docker -c "docker compose ps"
START_SERVICES

log "Services started."

# ---------------------------------------------------------------------------
# Step 9: Verify deployment
# ---------------------------------------------------------------------------
log "Waiting 15 seconds for services to initialize..."
sleep 15

log "Running health checks..."
remote_exec bash -s <<HEALTH_CHECK
set -euo pipefail
cd "${APP_DIR}"

echo "--- PocketBase health ---"
curl -sf http://localhost:8090/api/health && echo " OK" || echo " FAILED"

echo "--- LiteLLM health ---"
curl -sf http://localhost:4000/health && echo " OK" || echo " FAILED"

echo ""
echo "--- Container status ---"
sg docker -c "docker compose ps"
HEALTH_CHECK

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
log "============================================="
log "  PACE deployment complete!"
log "============================================="
log "  Instance:  ${INSTANCE_NAME}"
log "  IP:        ${INSTANCE_IP}"
log "  Region:    ${REGION}"
log "  SSH:       ssh -i ${SSH_KEY_PATH} ${REMOTE_USER}@${INSTANCE_IP}"
log ""
log "  Next steps:"
log "    1. Point your domain DNS A record to ${INSTANCE_IP}"
log "    2. Update DOMAIN in .env on the instance"
log "    3. Restart Caddy: ssh ... 'cd ${APP_DIR} && docker compose restart caddy'"
log "    4. Caddy will auto-provision SSL via Let's Encrypt"
log "============================================="
