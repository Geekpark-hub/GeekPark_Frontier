#!/bin/bash
set -euo pipefail
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society

scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/src-schema.prisma /tmp/src-rss.js /tmp/src-aiFeed.js /tmp/src-admin.js \
  /tmp/src-menus-server.js /tmp/src-auth.js /tmp/admin-dist-only.tgz \
  "$GALAXY:$REMOTE/" 2>/dev/null || true

scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/src-schema.prisma /tmp/src-rss.js /tmp/src-aiFeed.js /tmp/src-admin.js \
  /tmp/src-menus-server.js /tmp/src-auth.js /tmp/admin-dist-only.tgz \
  "$GALAXY:/tmp/"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"

cp /tmp/src-schema.prisma prisma/schema.prisma
cp /tmp/src-rss.js src/services/rss.js
cp /tmp/src-aiFeed.js src/jobs/aiFeed.js
cp /tmp/src-admin.js src/routes/admin.js
cp /tmp/src-menus-server.js src/menus.js
cp /tmp/src-auth.js src/routes/auth.js

rm -rf admin-dist
tar -xzf /tmp/admin-dist-only.tgz

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
export PATH="$REMOTE/.node/bin:$PATH"

npx prisma db push --skip-generate
npx prisma generate

nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 2
curl -sf http://127.0.0.1:3100/api/health >/dev/null

# 触发默认信息源种子
node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const { ensureDefaultNewsSources } = await import('./src/services/rss.js');
  const r = await ensureDefaultNewsSources();
  const n = await p.newsSource.count();
  console.log(JSON.stringify({ ...r, total: n }));
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
NODE

echo patch_sources_ok
REMOTE
