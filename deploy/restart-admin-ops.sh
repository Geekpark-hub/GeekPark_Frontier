#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"

echo "===log tail==="
tail -n 40 frontier-api.log || true

echo "===kill==="
if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "/home/ubuntu/apps/frontier-society/src/index.js" 2>/dev/null || true
sleep 2
for p in $(ss -lntp 2>/dev/null | grep ':3100' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do
  echo "kill $p"
  kill -9 "$p" 2>/dev/null || true
done
sleep 1
ss -lntp | grep 3100 || echo "3100_free"

set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
echo "new_pid=$(cat frontier-api.pid)"
sleep 3
curl -sf http://127.0.0.1:3100/api/health
echo
tail -n 15 frontier-api.log
echo restart_ok
