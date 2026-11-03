#!/bin/bash
set -euo pipefail
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
export PATH="/home/ubuntu/apps/frontier-society/.node/bin:$PATH"
cd /home/ubuntu/apps/frontier-society
set -a
. ./.env.production
set +a
export DATABASE_URL="file:/home/ubuntu/apps/frontier-society/data/prod.db"
node prisma/seed.js
REMOTE
