#!/bin/bash
set -euo pipefail
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"

# 强杀占用 3100 的进程
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3100/tcp 2>/dev/null || true
fi
pkill -f "$REMOTE/src/index.js" 2>/dev/null || true
sleep 1
rm -f frontier-api.pid

set -a
. ./.env.production
set +a
export PATH="$REMOTE/.node/bin:$PATH"
export DATABASE_URL="file:$REMOTE/data/prod.db"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100

# 确认 polyfill 能加载
node --input-type=module -e "import './src/polyfill-fetch.js'; console.log('fetch=', typeof fetch)"

nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 2
curl -sf -H 'Accept: application/json' http://127.0.0.1:3100/api/health >/dev/null && echo health_ok

LOGIN=$(curl -s -X POST http://127.0.0.1:3100/api/auth/admin-login \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"phone":"17611294568"}')
TOKEN=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$LOGIN")

curl -s -X POST http://127.0.0.1:3100/api/admin/ai/run-feed \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"limitPerMember":2,"async":true}'
echo

for i in $(seq 1 30); do
  sleep 4
  ST=$(curl -s http://127.0.0.1:3100/api/admin/ai/status \
    -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json')
  line=$(node -e "const j=JSON.parse(process.argv[1]); const r=j.currentRun||{}; console.log((r.status||'none')+'|'+(r.summary||''))" "$ST")
  echo "t=$i $line"
  case "$line" in
    running\|*) ;;
    *) break ;;
  esac
done

node --input-type=module <<'NODE'
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const l = await p.jobLog.findFirst({ where: { type: 'ai_feed' }, orderBy: { createdAt: 'desc' } });
console.log('LAST_SUMMARY', l?.summary);
console.log('LAST_DETAIL', l?.detail);
const pending = await p.feedPost.count({ where: { status: 'pending', sourceType: 'auto' } });
console.log('pendingAuto', pending);
await p.$disconnect();
NODE
REMOTE
