#!/bin/bash
set -euo pipefail
JUMP_KEY="${JUMP_KEY:-$HOME/.ssh/id_rsa}"
JUMP=ubuntu@120.92.119.154
JUMP_PORT=9922
TGZ="${1:-/tmp/frontier-member-rss.tgz}"

scp -o BatchMode=yes -o StrictHostKeyChecking=no -i "$JUMP_KEY" -P "$JUMP_PORT" \
  "$TGZ" "$JUMP:/tmp/frontier-member-rss.tgz"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i "$JUMP_KEY" -p "$JUMP_PORT" "$JUMP" bash -s <<'EOF'
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/frontier-member-rss.tgz \
  ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/

ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
rm -rf admin-dist
tar -xzf frontier-member-rss.tgz
test -f src/services/rss.js
test -f scripts/seed-member-rss-from-sheet.js
test -f data/rss-sheet-export.json
grep -n 'fetchMemberGoogleNewsRss\|EXTRA_RSS_FEEDS\|googleNewsRssZh' src/services/rss.js src/jobs/aiFeed.js prisma/schema.prisma | head -30
ls admin-dist/assets/Members-*.js | head -3
set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
npx prisma db push --skip-generate
npx prisma generate
node scripts/seed-member-rss-from-sheet.js
node --input-type=module -e "import { ensureDefaultNewsSources } from './src/services/rss.js'; const r = await ensureDefaultNewsSources(); console.log('newsSources', r);"
if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "$REMOTE/src/index.js" 2>/dev/null || true
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 2
curl -sf http://127.0.0.1:3100/api/health && echo
# 触发公共源补齐（访问新闻源列表）
curl -sf -o /dev/null -w "sources=%{http_code}\n" -H 'Accept: application/json' \
  http://127.0.0.1:3100/api/health || true
echo "PID=$(cat frontier-api.pid)"
REMOTE
EOF
