#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
cd "$REMOTE"

echo "=== env files ==="
ls -la .env .env.production .env.local 2>&1 || true

echo "=== process ==="
if [ -f frontier-api.pid ]; then
  PID=$(cat frontier-api.pid)
  echo "pid=$PID"
  if [ -r "/proc/$PID/environ" ]; then
    tr '\0' '\n' < "/proc/$PID/environ" \
      | grep -E '^(WX_|PORT=|DATABASE|ALLOW_MOCK|ADMIN_DIST|NODE_ENV)' \
      | sed -E 's/(WX_SECRET|DATABASE_URL)=.*/\1=SET/; s/(WX_APPID)=(.*)/\1=\2/' || true
  fi
else
  echo "no pid file"
  ps aux | grep 'src/index.js' | grep -v grep || true
fi

echo "=== wechat-login probe ==="
curl -s -X POST http://127.0.0.1:3100/api/auth/wechat-login \
  -H 'Content-Type: application/json' \
  -d '{"code":"bad"}' || true
echo

echo "=== public feed ==="
curl -s 'http://127.0.0.1:3100/api/feed?page=1&pageSize=2' | head -c 500
echo

echo "=== member count ==="
export PATH="$REMOTE/.node/bin:$PATH"
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const total = await p.member.count();
  const active = await p.member.count({ where: { status: 'active' } });
  const withOpenid = await p.member.count({ where: { openid: { not: null } } });
  const withPhone = await p.member.count({ where: { phone: { not: '' } } });
  console.log(JSON.stringify({ total, active, withOpenid, withPhone }));
  await p.\$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
"
