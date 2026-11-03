#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"

tar -xzf /tmp/frontier-admin-ops.tgz -C /tmp/frontier-admin-ops-extract 2>/dev/null || true
rm -rf /tmp/frontier-admin-ops-extract
mkdir -p /tmp/frontier-admin-ops-extract
tar -xzf /tmp/frontier-admin-ops.tgz -C /tmp/frontier-admin-ops-extract

# merge server files into app root (src/, prisma/, package.json)
cp -f /tmp/frontier-admin-ops-extract/server-pack/package.json "$REMOTE/package.json"
cp -f /tmp/frontier-admin-ops-extract/server-pack/package-lock.json "$REMOTE/package-lock.json"
cp -f /tmp/frontier-admin-ops-extract/server-pack/prisma/schema.prisma "$REMOTE/prisma/schema.prisma"
cp -f /tmp/frontier-admin-ops-extract/server-pack/src/menus.js "$REMOTE/src/menus.js"
cp -f /tmp/frontier-admin-ops-extract/server-pack/src/routes/auth.js "$REMOTE/src/routes/auth.js"
cp -f /tmp/frontier-admin-ops-extract/server-pack/src/routes/admin.js "$REMOTE/src/routes/admin.js"
cp -f /tmp/frontier-admin-ops-extract/server-pack/src/services/notify.js "$REMOTE/src/services/notify.js"
cp -f /tmp/frontier-admin-ops-extract/server-pack/src/services/feishu.js "$REMOTE/src/services/feishu.js"
cp -f /tmp/frontier-admin-ops-extract/server-pack/src/services/analytics.js "$REMOTE/src/services/analytics.js"
cp -f /tmp/frontier-admin-ops-extract/server-pack/src/services/notifyLog.js "$REMOTE/src/services/notifyLog.js"
mkdir -p "$REMOTE/src/utils"
cp -f /tmp/frontier-admin-ops-extract/server-pack/src/utils/adminPassword.js "$REMOTE/src/utils/adminPassword.js"

rm -rf "$REMOTE/admin-dist"
cp -a /tmp/frontier-admin-ops-extract/admin-dist "$REMOTE/admin-dist"

test -f "$REMOTE/src/services/notifyLog.js"
test -f "$REMOTE/src/utils/adminPassword.js"
ls "$REMOTE/admin-dist/assets/NotifyLogs-"*.js | head -1
ls "$REMOTE/admin-dist/assets/Analytics-"*.js | head -1

npm install --omit=dev
export DATABASE_URL="file:$REMOTE/data/prod.db"
npx prisma generate
npx prisma db push --skip-generate --accept-data-loss

# restart
if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "$REMOTE/src/index.js" 2>/dev/null || true
sleep 2
for p in $(ss -lntp 2>/dev/null | grep ':3100' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do
  kill -9 "$p" 2>/dev/null || true
done
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
grep -n "notify-logs\|admin-password\|analytics/export" src/routes/admin.js src/routes/auth.js | head -20
echo deploy_ok