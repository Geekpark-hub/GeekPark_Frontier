#!/bin/bash
set -euo pipefail
cd /home/ubuntu/apps/frontier-society
export PATH="/home/ubuntu/apps/frontier-society/.node/bin:$PATH"
grep -n "获取需求详情" src/routes/requests.js | head -3
if [ -f frontier-api.pid ]; then kill "$(cat frontier-api.pid)" 2>/dev/null || true; rm -f frontier-api.pid; fi
pkill -f "/home/ubuntu/apps/frontier-society/src/index.js" 2>/dev/null || true
sleep 1
set -a; . ./.env.production; set +a
export DATABASE_URL="file:/home/ubuntu/apps/frontier-society/data/prod.db"
export ADMIN_DIST="/home/ubuntu/apps/frontier-society/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 2
curl -sf http://127.0.0.1:3100/api/health | head -c 80; echo
echo PID=$(cat frontier-api.pid)
