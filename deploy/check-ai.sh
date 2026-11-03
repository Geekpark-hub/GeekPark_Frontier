#!/bin/bash
set -euo pipefail
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
echo "=== process ==="
ps aux | grep 'src/index.js' | grep -v grep || echo none
echo "=== env keys ==="
grep -E '^(ENABLE_JOBS|LLM_|SEARCH_|MODELINK|SERPER|CRON)' "$REMOTE/.env.production" | cut -d= -f1
echo "=== health ==="
curl -s http://127.0.0.1:3100/api/health
echo
echo "=== recent log ==="
tail -n 60 "$REMOTE/frontier-api.log"
echo "=== member count ==="
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
export DATABASE_URL="file:$REMOTE/data/prod.db"
node -e "import('dotenv/config'); import('@prisma/client').then(async ({PrismaClient})=>{const p=new PrismaClient(); console.log('members', await p.member.count()); console.log('active', await p.member.count({where:{status:'active', isAdmin:false, isSuperAdmin:false}})); console.log('jobs', await p.jobLog.count()); const last=await p.jobLog.findMany({orderBy:{createdAt:'desc'}, take:3}); console.log(JSON.stringify(last,null,2)); await p.\$disconnect();})"
REMOTE
