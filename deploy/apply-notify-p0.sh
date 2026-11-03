#!/bin/bash
set -euo pipefail
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society

scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-notify-p0.tgz "$GALAXY:$REMOTE/"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
tar -xzf frontier-notify-p0.tgz
test -f src/services/notify.js
test -f src/routes/notify.js
grep -q sendRegisterSuccessNotice src/routes/events.js
grep -q notifyEventRegistered src/services/feishu.js
grep -q processEventReminders src/jobs/maintenance.js
grep -q "api.use('/notify'" src/index.js
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
curl -sf http://127.0.0.1:3100/api/notify/templates && echo
echo "PID=$(cat frontier-api.pid)"
echo notify-p0-ok
REMOTE
