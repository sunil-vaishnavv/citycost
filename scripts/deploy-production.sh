#!/usr/bin/env bash
# CityCost production deploy — run on AWS EC2 at /opt/citycost
# Called by GitHub Actions after rsync. Preserves .env and data/.
set -euo pipefail

APP_DIR="/opt/citycost"
PM2_APP="citycost-web"
HEALTH_LOCAL="http://127.0.0.1:3001/health"
API_HEALTH_LOCAL="http://127.0.0.1:3001/api/health"
DEPLOY_COMMIT="${1:-unknown}"

cd "$APP_DIR"

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

log "Working directory: $APP_DIR"
log "PM2 app: $PM2_APP"
log "Health endpoints: $HEALTH_LOCAL · $API_HEALTH_LOCAL"

if [[ ! -f .env ]]; then
  log "ERROR: $APP_DIR/.env is missing — aborting (will not restart PM2)"
  exit 1
fi

log "Deploy commit: $DEPLOY_COMMIT"
log "Node $(node -v) · npm $(npm -v)"

log "Installing dependencies (npm ci)..."
log "Command: npm ci"
npm ci

log "Building (npm run build)..."
log "Command: npm run build"
npm run build

if [[ ! -f dist/index.html ]]; then
  log "ERROR: dist/index.html missing after build — aborting (will not restart PM2)"
  exit 1
fi

echo "$DEPLOY_COMMIT" > .deploy-commit
log "Wrote deploy commit to $APP_DIR/.deploy-commit"
chmod 600 .deploy-commit 2>/dev/null || true

log "Restarting PM2 ($PM2_APP)..."
log "Command: pm2 restart $PM2_APP --update-env"
pm2 restart "$PM2_APP" --update-env

log "Waiting for health endpoints..."
ready=0
for i in $(seq 1 45); do
  if curl -fsS "$HEALTH_LOCAL" >/dev/null 2>&1 && curl -fsS "$API_HEALTH_LOCAL" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  log "ERROR: Local health check failed after PM2 restart"
  pm2 status "$PM2_APP" || true
  pm2 logs "$PM2_APP" --lines 30 --nostream 2>&1 | tail -35 || true
  exit 1
fi

if ! sudo nginx -t >/dev/null 2>&1; then
  log "ERROR: nginx -t failed"
  exit 1
fi

log "Local health OK"
health_body=$(curl -fsS "$HEALTH_LOCAL")
echo "${health_body:0:200}"
echo
pm2 status "$PM2_APP"
log "Deploy succeeded: $DEPLOY_COMMIT"
