#!/bin/bash
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/frontier-audit.tgz \
  ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/

ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
rm -rf admin-dist
tar -xzf frontier-audit.tgz
test -f src/services/adminAudit.js
test -f prisma/schema.prisma
grep -n 'AdminAuditLog\|audit-logs\|adminAuditMiddleware' src/routes/admin.js prisma/schema.prisma src/services/adminAudit.js | head -20
set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
npx prisma db push --skip-generate
npx prisma generate
if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "$REMOTE/src/index.js" 2>/dev/null || true
export PATH="$REMOTE/.node/bin:$PATH"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 2
curl -sf http://127.0.0.1:3100/api/health && echo
echo "PID=$(cat frontier-api.pid)"
REMOTE
