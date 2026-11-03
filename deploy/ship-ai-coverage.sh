#!/bin/bash
set -euo pipefail
JUMP_KEY="${JUMP_KEY:-$HOME/.ssh/id_rsa}"
JUMP=ubuntu@120.92.119.154
JUMP_PORT=9922
TGZ="${1:-/tmp/frontier-ai-coverage.tgz}"

scp -o BatchMode=yes -o StrictHostKeyChecking=no -i "$JUMP_KEY" -P "$JUMP_PORT" \
  "$TGZ" "$JUMP:/tmp/frontier-ai-coverage.tgz"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i "$JUMP_KEY" -p "$JUMP_PORT" "$JUMP" bash -s <<'EOF'
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/frontier-ai-coverage.tgz \
  ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/

ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
rm -rf admin-dist
tar -xzf frontier-ai-coverage.tgz
grep -n 'candidateLimit\|LIMIT_PER_MEMBER || 10\|limitPerMember \* 5, 40' src/jobs/aiFeed.js src/routes/admin.js | head -20
# 覆盖线上旧默认 5
if [ -f .env.production ]; then
  if grep -q '^AI_FEED_LIMIT_PER_MEMBER=' .env.production; then
    sed -i 's/^AI_FEED_LIMIT_PER_MEMBER=.*/AI_FEED_LIMIT_PER_MEMBER=10/' .env.production
  else
    echo 'AI_FEED_LIMIT_PER_MEMBER=10' >> .env.production
  fi
fi
if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "$REMOTE/src/index.js" 2>/dev/null || true
set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
export ADMIN_DIST="$REMOTE/admin-dist"
export PORT=3100
nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 2
curl -sf http://127.0.0.1:3100/api/health && echo
echo "PID=$(cat frontier-api.pid) LIMIT=$AI_FEED_LIMIT_PER_MEMBER"
REMOTE
EOF
