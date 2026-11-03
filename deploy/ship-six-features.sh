#!/bin/bash
set -euo pipefail
JUMP_KEY="${JUMP_KEY:-$HOME/.ssh/id_rsa}"
JUMP=ubuntu@120.92.119.154
JUMP_PORT=9922
REMOTE=/home/ubuntu/apps/frontier-society
TGZ="${1:-/tmp/frontier-six-features.tgz}"
REGEN="${REGEN:-1}"

scp -o BatchMode=yes -o StrictHostKeyChecking=no -i "$JUMP_KEY" -P "$JUMP_PORT" \
  "$TGZ" "$JUMP:/tmp/frontier-six-features.tgz"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i "$JUMP_KEY" -p "$JUMP_PORT" "$JUMP" \
  "REGEN=$REGEN" bash -s <<'EOF'
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/frontier-six-features.tgz \
  ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/

ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 \
  "REGEN=${REGEN:-1}" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
rm -rf admin-dist
tar -xzf frontier-six-features.tgz
test -f src/utils/inviteCode.js
test -f src/wx.js
test -f src/jobs/aiFeed.js
test -f prisma/schema.prisma
ls admin-dist/assets/Members-*.js | head -2
ls admin-dist/assets/Polls-*.js | head -2
# deps (pinyin-pro etc.)
npm install --omit=dev
cp prisma/schema.prisma "prisma/schema.prisma.bak.$(date +%s)" 2>/dev/null || true
npx prisma generate
npx prisma db push --skip-generate --accept-data-loss
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
code=$(curl -s -o /tmp/bind-invite.out -w "%{http_code}" -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:3100/api/auth/bind-invite || true)
echo "bind-invite_http=$code"
head -c 200 /tmp/bind-invite.out; echo
if [ "${REGEN:-1}" = "1" ] && [ -f scripts/regen-invite-codes-yyf1703.js ]; then
  echo "regen invite codes..."
  node scripts/regen-invite-codes-yyf1703.js | tail -n 30
fi
echo "PID=$(cat frontier-api.pid)"
REMOTE
EOF
