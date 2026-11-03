#!/bin/bash
set -euo pipefail
JUMP_KEY="${JUMP_KEY:-$HOME/.ssh/id_rsa}"
JUMP=ubuntu@120.92.119.154
JUMP_PORT=9922
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society
TGZ="${1:-/tmp/frontier-invite-auth.tgz}"

scp -o BatchMode=yes -o StrictHostKeyChecking=no -i "$JUMP_KEY" -P "$JUMP_PORT" \
  "$TGZ" "$JUMP:/tmp/frontier-invite-auth.tgz"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i "$JUMP_KEY" -p "$JUMP_PORT" "$JUMP" bash -s <<'EOF'
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/frontier-invite-auth.tgz \
  ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/

ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
rm -rf admin-dist
tar -xzf frontier-invite-auth.tgz
test -f src/utils/inviteCode.js
grep -n 'bind-invite\|inviteCode' src/routes/auth.js | head -10
grep -n 'inviteCode\|regenInvite\|invite' src/routes/admin.js | head -15
ls admin-dist/assets/Members-*.js | head -3
# schema + db push
cp prisma/schema.prisma prisma/schema.prisma.bak.$(date +%s) 2>/dev/null || true
npx prisma generate
npx prisma db push --skip-generate
if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "$REMOTE/src/index.js" 2>/dev/null || true
sleep 1
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
curl -sf http://127.0.0.1:3100/api/health && echo
# bind-invite should not 404 (expect 400/401 without body)
code=$(curl -s -o /tmp/bind-invite.out -w "%{http_code}" -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:3100/api/auth/bind-invite || true)
echo "bind-invite_http=$code"
head -c 200 /tmp/bind-invite.out; echo
echo "PID=$(cat frontier-api.pid)"
REMOTE
EOF
