#!/bin/bash
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/frontier-event-feed.tgz \
  ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/

ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
rm -rf admin-dist
tar -xzf frontier-event-feed.tgz
test -f prisma/schema.prisma
grep -n showInFeed prisma/schema.prisma | head -3
grep -n feed-active src/routes/events.js | head -3
grep -n showInFeed src/routes/admin.js | head -3
ls admin-dist/assets/Events-*.js | head -2
grep -l showInFeed admin-dist/assets/Events-*.js
cp prisma/schema.prisma "prisma/schema.prisma.bak.$(date +%s)" 2>/dev/null || true
set -a
. ./.env.production
set +a
export PATH="$REMOTE/.node/bin:$PATH"
export DATABASE_URL="file:$REMOTE/data/prod.db"
npx prisma generate
npx prisma db push --skip-generate --accept-data-loss
if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "$REMOTE/src/index.js" 2>/dev/null || true
sleep 1
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 2
curl -sf http://127.0.0.1:3100/api/health && echo
echo "PID=$(cat frontier-api.pid)"
REMOTE
