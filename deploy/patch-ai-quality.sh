#!/bin/bash
set -euo pipefail
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society

scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/ai-urlQuality.js /tmp/ai-llm.js /tmp/ai-aiFeed.js \
  "$GALAXY:/tmp/"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"

cp /tmp/ai-urlQuality.js src/services/urlQuality.js
cp /tmp/ai-llm.js src/services/llm.js
cp /tmp/ai-aiFeed.js src/jobs/aiFeed.js

# 下架误抓的栏目页动态
set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const bad = await p.feedPost.deleteMany({
    where: {
      OR: [
        { sourceUrl: { contains: '/column/' } },
        { title: { contains: '科技商业观察专栏' } },
      ],
    },
  });
  console.log('deleted_bad', bad.count);
  await p.$disconnect();
})();
NODE

# 重启 API
if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
fuser -k 3100/tcp 2>/dev/null || true
sleep 1
set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 2
curl -sf http://127.0.0.1:3100/api/health >/dev/null && echo patch_ai_quality_ok
REMOTE
