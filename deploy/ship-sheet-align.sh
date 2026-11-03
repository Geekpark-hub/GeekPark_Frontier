#!/bin/bash
set -euo pipefail
JUMP_KEY="${JUMP_KEY:-$HOME/.ssh/id_rsa}"
JUMP=ubuntu@120.92.119.154
JUMP_PORT=9922
TGZ="${1:-/tmp/frontier-sheet-align.tgz}"

scp -o BatchMode=yes -o StrictHostKeyChecking=no -i "$JUMP_KEY" -P "$JUMP_PORT" \
  "$TGZ" "$JUMP:/tmp/frontier-sheet-align.tgz"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i "$JUMP_KEY" -p "$JUMP_PORT" "$JUMP" bash -s <<'EOF'
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/frontier-sheet-align.tgz \
  ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/

ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
tar -xzf frontier-sheet-align.tgz
test -f src/services/rss.js
test -f scripts/seed-member-rss-from-sheet.js
grep -n 'SHEET_RSS_FEEDS\|syncSheetNewsSources' src/services/rss.js | head -10
set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
node --input-type=module -e "import { syncSheetNewsSources } from './src/services/rss.js'; console.log(await syncSheetNewsSources());"
node scripts/seed-member-rss-from-sheet.js
node --input-type=module <<'JS'
import { prisma } from './src/prisma.js';
const enabled = await prisma.newsSource.findMany({ where: { enabled: true }, select: { key: true, name: true, url: true }, orderBy: { sort: 'asc' } });
const disabled = await prisma.newsSource.count({ where: { enabled: false } });
const members = await prisma.member.count({ where: { isAdmin: false, isSuperAdmin: false } });
const withGn = await prisma.member.count({ where: { isAdmin: false, isSuperAdmin: false, googleNewsRssZh: { not: '' } } });
console.log(JSON.stringify({ enabledSources: enabled.length, disabledSources: disabled, members, withGoogleNews: withGn, enabledKeys: enabled.map(s => s.key) }, null, 2));
await prisma.$disconnect();
JS
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
echo "PID=$(cat frontier-api.pid)"
REMOTE
EOF
