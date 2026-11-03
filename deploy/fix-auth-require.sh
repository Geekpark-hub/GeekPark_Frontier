#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"

# patch import if missing requireAuth
node <<'NODE'
import fs from 'fs';
const p = 'src/routes/auth.js';
let s = fs.readFileSync(p, 'utf8');
const bad = "import { isStaff, requireAdmin, signToken } from '../middleware/auth.js';";
const good = "import { isStaff, requireAuth, requireAdmin, signToken } from '../middleware/auth.js';";
if (s.includes(bad)) {
  s = s.replace(bad, good);
  fs.writeFileSync(p, s);
  console.log('patched_import');
} else if (s.includes('requireAuth, requireAdmin')) {
  console.log('import_already_ok');
} else {
  console.log('unexpected_import');
  process.exit(1);
}
NODE

if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "/home/ubuntu/apps/frontier-society/src/index.js" 2>/dev/null || true
sleep 2
for p in $(ss -lntp 2>/dev/null | grep ':3100' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u); do
  kill -9 "$p" 2>/dev/null || true
done
sleep 1

set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
echo "pid=$(cat frontier-api.pid)"
sleep 3
echo "===health==="
curl -sf http://127.0.0.1:3100/api/health
echo
echo "===routes==="
grep -n "requireAuth\|admin-password\|notify-logs\|analytics/export" src/routes/auth.js src/routes/admin.js | head -20
echo fix_ok
