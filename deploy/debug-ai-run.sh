#!/bin/bash
set -euo pipefail
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
export DATABASE_URL="file:$REMOTE/data/prod.db"

echo "=== members ==="
node --input-type=module -e '
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const all = await p.member.findMany({ select: { id:true, name:true, phone:true, company:true, status:true, isAdmin:true, isSuperAdmin:true }});
console.log(JSON.stringify(all, null, 2));
await p.$disconnect();
'

echo "=== login + run-feed ==="
LOGIN=$(curl -s -X POST http://127.0.0.1:3100/api/auth/admin-login -H 'Content-Type: application/json' -d '{"phone":"17611294568"}')
echo "$LOGIN" | head -c 300; echo
TOKEN=$(node -e "const j=JSON.parse(process.argv[1]); if(!j.token) process.exit(2); process.stdout.write(j.token)" "$LOGIN")

echo "=== ai status before ==="
curl -s http://127.0.0.1:3100/api/admin/ai/status -H "Authorization: Bearer $TOKEN"
echo

echo "=== post run-feed ==="
curl -s -X POST http://127.0.0.1:3100/api/admin/ai/run-feed \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"limitPerMember":2,"async":true}'
echo
sleep 2
echo "=== ai status after ==="
curl -s http://127.0.0.1:3100/api/admin/ai/status -H "Authorization: Bearer $TOKEN"
echo
echo "=== last logs ==="
tail -n 40 "$REMOTE/frontier-api.log"
REMOTE
