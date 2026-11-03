#!/bin/bash
set -euo pipefail
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society

scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/frontier-fetch-fix.tgz "$GALAXY:$REMOTE/"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
tar -xzf frontier-fetch-fix.tgz
npm install node-fetch@2 --save --registry=https://registry.npmmirror.com

if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "$REMOTE/src/index.js" 2>/dev/null || true

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
curl -sf -H 'Accept: application/json' http://127.0.0.1:3100/api/health >/dev/null && echo up

LOGIN=$(curl -s -X POST http://127.0.0.1:3100/api/auth/admin-login \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"phone":"17611294568"}')
TOKEN=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$LOGIN")
curl -s -X POST http://127.0.0.1:3100/api/admin/ai/run-feed \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"limitPerMember":2,"async":true}'
echo
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  sleep 3
  ST=$(curl -s http://127.0.0.1:3100/api/admin/ai/status \
    -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json')
  line=$(node -e "const j=JSON.parse(process.argv[1]); const r=j.currentRun||{}; console.log((r.status||'none')+'|'+(r.summary||''))" "$ST")
  echo "t=$i $line"
  echo "$line" | grep -q '^running|' || break
done
REMOTE
