#!/bin/bash
set -euo pipefail
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
export DATABASE_URL="file:$REMOTE/data/prod.db"

LOGIN=$(curl -s -X POST http://127.0.0.1:3100/api/auth/admin-login \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"phone":"17611294568"}')
TOKEN=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$LOGIN")

echo "=== trigger ==="
curl -s -X POST http://127.0.0.1:3100/api/admin/ai/run-feed \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"limitPerMember":2,"async":true}'
echo

for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 3
  ST=$(curl -s http://127.0.0.1:3100/api/admin/ai/status \
    -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json')
  STATUS=$(node -e "const j=JSON.parse(process.argv[1]); const r=j.currentRun||{}; console.log(r.status||'none', (r.summary||'').slice(0,120))" "$ST")
  echo "t=${i} $STATUS"
  echo "$STATUS" | grep -q 'running' || break
done

echo "=== latest jobLog ==="
node --input-type=module -e '
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const logs = await p.jobLog.findMany({ where:{ type:"ai_feed" }, orderBy:{ createdAt:"desc" }, take:3 });
console.log(JSON.stringify(logs, null, 2));
const pending = await p.feedPost.count({ where:{ status:"pending", sourceType:"auto" }});
console.log("pendingAuto", pending);
await p.$disconnect();
'
REMOTE
