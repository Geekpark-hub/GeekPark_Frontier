#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
echo "===pid==="
cat frontier-api.pid 2>/dev/null || true
ps -ef | grep "src/index.js" | grep -v grep || true
echo "===health==="
curl -sf http://127.0.0.1:3100/api/health
echo
echo "===checks==="
grep -n "notify-logs" src/routes/admin.js | head -1
grep -n "admin-password" src/routes/auth.js | head -1
grep -n "analytics/export" src/routes/admin.js | head -1
ls admin-dist/assets/NotifyLogs-*.js | head -1
ls admin-dist/assets/Login-*.js | head -1
grep -n "adminPasswordHash" prisma/schema.prisma | head -1
grep -n "model NotifyLog" prisma/schema.prisma | head -1
# if process dead, restart
if ! curl -sf http://127.0.0.1:3100/api/health >/dev/null; then
  echo "===restart==="
  if [ -f frontier-api.pid ]; then kill "$(cat frontier-api.pid)" 2>/dev/null || true; rm -f frontier-api.pid; fi
  pkill -f "$REMOTE/src/index.js" 2>/dev/null || true
  sleep 1
  set -a; . ./.env.production; set +a
  export DATABASE_URL="file:$REMOTE/data/prod.db"
  export ADMIN_DIST="$REMOTE/admin-dist"
  export PORT=3100
  nohup node src/index.js > frontier-api.log 2>&1 &
  echo $! > frontier-api.pid
  sleep 2
  curl -sf http://127.0.0.1:3100/api/health && echo
fi
echo verify_ok
