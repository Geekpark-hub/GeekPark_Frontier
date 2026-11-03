#!/bin/bash
set -euo pipefail

GALAXY=ubuntu@192.168.123.14
REMOTE_DIR=/home/ubuntu/apps/frontier-society
# Ubuntu 18.04 glibc 2.27 → Node 16（Node 18+ 需要 GLIBC_2.28）
NODE_VER=16.20.2

echo "[1] sync package"
ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" "mkdir -p $REMOTE_DIR"
scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-society-deploy.tgz "$GALAXY:$REMOTE_DIR/"

echo "[2] install node + app on galaxy"
ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE_DIR=/home/ubuntu/apps/frontier-society
NODE_VER=16.20.2
NODE_DIR="$REMOTE_DIR/.node"
cd "$REMOTE_DIR"
tar -xzf frontier-society-deploy.tgz

if [ ! -x "$NODE_DIR/bin/node" ]; then
  cd /tmp
  if [ ! -d "/tmp/node-v${NODE_VER}-linux-x64" ]; then
    curl -fsSL -o node.tar.xz "https://npmmirror.com/mirrors/node/v${NODE_VER}/node-v${NODE_VER}-linux-x64.tar.xz"
    tar -xJf node.tar.xz
  fi
  rm -rf "$NODE_DIR"
  cp -a "/tmp/node-v${NODE_VER}-linux-x64" "$NODE_DIR"
fi
export PATH="$NODE_DIR/bin:$PATH"
node -v
npm -v

cd "$REMOTE_DIR"
mkdir -p data uploads
npm config set registry https://registry.npmmirror.com
npm ci
npx prisma generate
export DATABASE_URL="file:$REMOTE_DIR/data/prod.db"
npx prisma db push --skip-generate

if [ -f frontier-api.pid ]; then
  kill "$(cat frontier-api.pid)" 2>/dev/null || true
  rm -f frontier-api.pid
fi
pkill -f "$REMOTE_DIR/src/index.js" 2>/dev/null || true

set -a
# shellcheck disable=SC1091
. ./.env.production
set +a
export PATH="$NODE_DIR/bin:$PATH"
export DATABASE_URL="file:$REMOTE_DIR/data/prod.db"
export ADMIN_DIST="$REMOTE_DIR/admin-dist"
export PORT=3100

nohup node src/index.js > frontier-api.log 2>&1 &
echo $! > frontier-api.pid
sleep 3
curl -sf "http://127.0.0.1:3100/health"
echo
echo "PID=$(cat frontier-api.pid)"
REMOTE

echo "[3] native install done"
