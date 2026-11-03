#!/bin/bash
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/debug-ai-rejects-remote.mjs ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
cd /home/ubuntu/apps/frontier-society
set -a
. ./.env.production
set +a
export PATH="$PWD/.node/bin:$PATH"
export DATABASE_URL="file:$PWD/data/prod.db"
node debug-ai-rejects-remote.mjs
rm -f debug-ai-rejects-remote.mjs
REMOTE
