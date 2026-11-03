#!/bin/bash
set -euo pipefail

GALAXY=ubuntu@192.168.123.14
REMOTE_DIR=/home/ubuntu/apps/frontier-society

echo "[1/4] sync package to galaxy"
ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" "mkdir -p $REMOTE_DIR"
scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-society-deploy.tgz "$GALAXY:$REMOTE_DIR/"

echo "[2/4] extract"
ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" "bash -lc '
  set -e
  cd $REMOTE_DIR
  tar -xzf frontier-society-deploy.tgz
  # docker-compose v1 compatibility
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=\"docker-compose\"
  elif docker compose version >/dev/null 2>&1; then
    COMPOSE=\"docker compose\"
  else
    echo \"no docker-compose\"; exit 1
  fi
  echo using: \$COMPOSE
  \$COMPOSE build
  \$COMPOSE up -d
  sleep 3
  \$COMPOSE ps
  curl -sf http://127.0.0.1:3100/health || (echo HEALTH_FAIL; \$COMPOSE logs --tail=80; exit 1)
'"

echo "[3/4] done on galaxy"
