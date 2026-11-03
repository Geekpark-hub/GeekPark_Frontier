#!/bin/bash
set -euo pipefail
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society

scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-stable-share.tgz "$GALAXY:$REMOTE/"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
tar -xzf frontier-stable-share.tgz
test -f src/services/shareLink.js
test -f src/routes/shareRedirect.js
grep -q 'stableShareUrl' src/routes/admin.js
grep -q "app.use('/s'" src/index.js
ls admin-dist/assets/Events-*.js | head -1
export DATABASE_URL="file:$REMOTE/data/prod.db"
npx prisma db push --skip-generate
npx prisma generate
if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "$REMOTE/src/index.js" 2>/dev/null || true
sleep 1
set -a
. ./.env.production
set +a
export PATH="$REMOTE/.node/bin:$PATH"
export DATABASE_URL="file:$REMOTE/data/prod.db"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 2
curl -sf http://127.0.0.1:3100/api/health && echo
# smoke: unknown id should 404 html, not SPA
code=$(curl -s -o /tmp/s-smoke.html -w '%{http_code}' http://127.0.0.1:3100/s/e/does-not-exist)
echo "smoke_/s/e=$code"
grep -q '活动不存在' /tmp/s-smoke.html
echo "PID=$(cat frontier-api.pid)"
echo stable-share-ok
REMOTE
