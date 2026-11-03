#!/bin/bash
set -euo pipefail
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society

scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/rss-rss.js /tmp/rss-aiFeed.js /tmp/rss-admin.js \
  "$GALAXY:/tmp/"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"

cp /tmp/rss-rss.js src/services/rss.js
cp /tmp/rss-aiFeed.js src/jobs/aiFeed.js
cp /tmp/rss-admin.js src/routes/admin.js

if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
fuser -k 3100/tcp 2>/dev/null || true
sleep 1

set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 2
curl -sf http://127.0.0.1:3100/api/health >/dev/null && echo patch_rss_ok
REMOTE
