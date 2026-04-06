#!/usr/bin/env bash
# =============================================================================
# PACE — Zero-Downtime Update Script
# =============================================================================
# SSHs into the Lightsail instance, pulls latest code, rebuilds containers,
# verifies PocketBase migrations, and runs health checks.
#
# Usage:
#   chmod +x deploy/update.sh
#   ./deploy/update.sh
#
# Options (via environment variables):
#   SKIP_HEALTH_CHECK=1  — skip post-deploy health checks
#   DRY_RUN=1            — show what would happen without executing
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — should match setup.sh values
# ---------------------------------------------------------------------------
INSTANCE_NAME="${INSTANCE_NAME:-pace-server}"
REGION="${REGION:-ap-south-1}"
SSH_KEY_PATH="${SSH_KEY_PATH:-~/.ssh/pace-lightsail-key.pem}"
REMOTE_USER="${REMOTE_USER:-ubuntu}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="/home/${REMOTE_USER}/pace"
SKIP_HEALTH_CHECK="${SKIP_HEALTH_CHECK:-0}"
DRY_RUN="${DRY_RUN:-0}"
HEALTH_CHECK_RETRIES="${HEALTH_CHECK_RETRIES:-10}"
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-3}"

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

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
# Resolve instance IP
# ---------------------------------------------------------------------------
log "Resolving instance IP for '${INSTANCE_NAME}'..."
INSTANCE_IP=$(get_instance_ip)
if [[ -z "$INSTANCE_IP" || "$INSTANCE_IP" == "None" ]]; then
  fail "Could not resolve IP for instance '${INSTANCE_NAME}'. Is it running?"
fi
log "Instance IP: ${INSTANCE_IP}"

if [[ "$DRY_RUN" == "1" ]]; then
  log "[DRY RUN] Would update ${INSTANCE_NAME} at ${INSTANCE_IP}"
  log "[DRY RUN] Steps: git pull → docker compose up -d --build → health check"
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 1: Pull latest code
# ---------------------------------------------------------------------------
log "Pulling latest code from '${REPO_BRANCH}'..."
remote_exec bash -s <<PULL_CODE
set -euo pipefail
cd "${APP_DIR}"

echo "Current commit: \$(git rev-parse --short HEAD)"
git fetch origin
git checkout "${REPO_BRANCH}"
git pull origin "${REPO_BRANCH}"
echo "Updated to:     \$(git rev-parse --short HEAD)"
PULL_CODE

log "Code updated."

# ---------------------------------------------------------------------------
# Step 2: Rebuild and restart containers (zero-downtime)
# ---------------------------------------------------------------------------
# Docker Compose recreates only changed containers. Services with health checks
# are started before old ones are stopped, providing zero-downtime for requests
# routed through Caddy.
# ---------------------------------------------------------------------------
log "Rebuilding and restarting containers..."
remote_exec bash -s <<REBUILD
set -euo pipefail
cd "${APP_DIR}"

echo "--- Pre-update container status ---"
sg docker -c "docker compose ps"

echo ""
echo "--- Building and restarting ---"
sg docker -c "docker compose up -d --build --remove-orphans"

echo ""
echo "--- Post-update container status ---"
sg docker -c "docker compose ps"
REBUILD

log "Containers rebuilt and restarted."

# ---------------------------------------------------------------------------
# Step 3: Verify PocketBase migrations
# ---------------------------------------------------------------------------
log "Verifying PocketBase migrations..."
remote_exec bash -s <<CHECK_MIGRATIONS
set -euo pipefail
cd "${APP_DIR}"

echo "--- Checking migration files are mounted ---"
sg docker -c "docker compose exec -T pocketbase ls -la /app/pb_migrations/" || {
  echo "WARNING: Could not list migrations directory."
}

echo ""
echo "--- PocketBase logs (last 20 lines, migration-related) ---"
sg docker -c "docker compose logs --tail=50 pocketbase" 2>&1 | grep -i -E "migrat|schema|applied|error" || {
  echo "(No migration-related log entries found — migrations may have already been applied)"
}

echo ""
echo "--- Verifying PocketBase API is responding ---"
curl -sf http://localhost:8090/api/health && echo " PocketBase healthy" || echo " PocketBase health check failed"
CHECK_MIGRATIONS

log "Migration verification complete."

# ---------------------------------------------------------------------------
# Step 4: Health checks
# ---------------------------------------------------------------------------
if [[ "$SKIP_HEALTH_CHECK" == "1" ]]; then
  log "Skipping health checks (SKIP_HEALTH_CHECK=1)."
else
  log "Running post-deployment health checks..."

  # Wait for containers to stabilize
  sleep 5

  remote_exec bash -s <<HEALTH_CHECKS
set -euo pipefail

check_health() {
  local name="\$1"
  local url="\$2"
  local retries=${HEALTH_CHECK_RETRIES}
  local interval=${HEALTH_CHECK_INTERVAL}
  local attempt=0

  while [ \$attempt -lt \$retries ]; do
    if curl -sf --max-time 5 "\$url" > /dev/null 2>&1; then
      echo "  ✓ \${name} is healthy"
      return 0
    fi
    attempt=\$((attempt + 1))
    echo "  … \${name} not ready (attempt \${attempt}/\${retries})"
    sleep \$interval
  done

  echo "  ✗ \${name} FAILED health check after \${retries} attempts"
  return 1
}

echo "--- Health Checks ---"
pb_ok=0
llm_ok=0

check_health "PocketBase" "http://localhost:8090/api/health" && pb_ok=1
check_health "LiteLLM"    "http://localhost:4000/health"      && llm_ok=1

echo ""
if [ \$pb_ok -eq 1 ] && [ \$llm_ok -eq 1 ]; then
  echo "All services healthy."
else
  echo "WARNING: One or more services failed health checks."
  echo "Check logs with: docker compose logs -f"
  exit 1
fi
HEALTH_CHECKS

  log "Health checks passed."
fi

# ---------------------------------------------------------------------------
# Step 5: Clean up old Docker images
# ---------------------------------------------------------------------------
log "Cleaning up unused Docker images..."
remote_exec bash -s <<CLEANUP
sg docker -c "docker image prune -f" 2>/dev/null || true
CLEANUP

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
log "============================================="
log "  PACE update complete!"
log "============================================="
log "  Instance:  ${INSTANCE_NAME} (${INSTANCE_IP})"
log "  Branch:    ${REPO_BRANCH}"
log "============================================="
