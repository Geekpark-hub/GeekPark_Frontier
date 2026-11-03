#!/bin/bash
set -euo pipefail
cd /home/ubuntu/apps/frontier-society
export PATH="/home/ubuntu/apps/frontier-society/.node/bin:$PATH"
export DATABASE_URL="file:/home/ubuntu/apps/frontier-society/data/prod.db"
cp /tmp/check-test-events.mjs ./check-test-events.mjs
node ./check-test-events.mjs
rm -f ./check-test-events.mjs
echo "--- recent cancel ---"
grep cancel-register frontier-api.log | tail -n 15 || true
