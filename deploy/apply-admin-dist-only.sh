#!/bin/bash
set -euo pipefail
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society

scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/admin-dist-only.tgz "$GALAXY:$REMOTE/"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
cd "$REMOTE"
rm -rf admin-dist
tar -xzf admin-dist-only.tgz
ls admin-dist/assets/Requests*.js
grep -l 'metaLine\|写备注' admin-dist/assets/Requests-*.js | head -3
curl -sf http://127.0.0.1:3100/api/health && echo
echo admin-dist-ok
REMOTE
