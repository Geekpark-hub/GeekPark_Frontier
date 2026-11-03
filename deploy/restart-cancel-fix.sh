#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"

echo "before:"
ss -lntp | grep 3100 || true
ps -ef | grep "src/index.js" | grep -v grep || true

if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "/home/ubuntu/apps/frontier-society/src/index.js" 2>/dev/null || true
sleep 2

# kill whatever still holds 3100
for p in $(ss -lntp 2>/dev/null | grep ':3100' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do
  echo "kill port pid $p"
  kill -9 "$p" 2>/dev/null || true
done
sleep 1
ss -lntp | grep 3100 || echo "3100_free"

grep -q cancel-register src/routes/events.js
grep -q notifyEventCancelled src/services/feishu.js

set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
echo "new_pid=$(cat frontier-api.pid)"
sleep 2

curl -sf http://127.0.0.1:3100/api/health >/dev/null && echo health_ok
echo -n "cancel="
curl -s -o /tmp/c.out -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "{}" \
  http://127.0.0.1:3100/api/events/test-id/cancel-register
echo
cat /tmp/c.out
echo
ps -ef | grep "src/index.js" | grep -v grep || true
