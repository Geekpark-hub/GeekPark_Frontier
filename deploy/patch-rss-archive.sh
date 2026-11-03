#!/bin/bash
set -euo pipefail
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society

scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/ra-schema.prisma /tmp/ra-rss.js /tmp/ra-scheduler.js /tmp/admin-dist-only.tgz \
  "$GALAXY:/tmp/"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"

cp /tmp/ra-schema.prisma prisma/schema.prisma
cp /tmp/ra-rss.js src/services/rss.js
cp /tmp/ra-scheduler.js src/jobs/scheduler.js
rm -rf admin-dist
tar -xzf /tmp/admin-dist-only.tgz

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
export PATH="$REMOTE/.node/bin:$PATH"

npx prisma db push --skip-generate
npx prisma generate

nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 3
curl -sf http://127.0.0.1:3100/api/health >/dev/null
sleep 8
tail -n 30 frontier-api.log | grep -E 'rss_ingest|listening|Error' || true
echo patch_rss_archive_ok
REMOTE
