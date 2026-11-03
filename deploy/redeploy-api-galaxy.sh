#!/bin/bash
set -euo pipefail
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society

scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-api-src.tgz "$GALAXY:$REMOTE/"
ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
NODE_DIR="$REMOTE/.node"
export PATH="$NODE_DIR/bin:$PATH"
cd "$REMOTE"
tar -xzf frontier-api-src.tgz
# 保留 .env.production / data / node_modules
if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "$REMOTE/src/index.js" 2>/dev/null || true
set -a
. ./.env.production
set +a
export PATH="$NODE_DIR/bin:$PATH"
export DATABASE_URL="file:$REMOTE/data/prod.db"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 2
curl -sf http://127.0.0.1:3100/api/health
echo
curl -sf -o /dev/null -w "spa_feed=%{http_code}\n" -H 'Accept: text/html' http://127.0.0.1:3100/feed
REMOTE
