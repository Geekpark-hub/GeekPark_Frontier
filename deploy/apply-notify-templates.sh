#!/bin/bash
set -euo pipefail
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society

scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-notify-tmpl.tgz "$GALAXY:$REMOTE/"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
tar -xzf frontier-notify-tmpl.tgz
test -f src/services/notify.js
ENVF=.env.production
upsert() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENVF" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENVF"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENVF"
  fi
}
upsert WX_SUBSCRIBE_TEMPLATE_EVENT_REMIND 'gZOoiCjD-ktnDLGeetPz2uu3_FfTuYDtGwuQntts-y4'
upsert WX_SUBSCRIBE_TEMPLATE_REGISTER 'LGKkrn--DO4u2vxyU4vVx1-zI1yJ0pRyuTcEoWp34S0'
upsert WX_SUBSCRIBE_TEMPLATE_EXPIRY 'GA0JfTFGL3MSejosP8zDc1wuTcC9XAWHb2nyZT6vI3o'
upsert WX_SUBSCRIBE_TEMPLATE_ID 'GA0JfTFGL3MSejosP8zDc1wuTcC9XAWHb2nyZT6vI3o'
echo '--- env ---'
grep -E '^WX_SUBSCRIBE_TEMPLATE_' "$ENVF"
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
echo '--- templates ---'
curl -sf http://127.0.0.1:3100/api/notify/templates
echo
echo "PID=$(cat frontier-api.pid)"
echo notify-tmpl-ok
REMOTE
