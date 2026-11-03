#!/bin/bash
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no \
  /tmp/frontier-ai-limit-admin.tgz \
  ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/

ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
cd /home/ubuntu/apps/frontier-society
rm -rf admin-dist
tar -xzf frontier-ai-limit-admin.tgz
ls admin-dist/assets/aiJob-*.js
grep -o 'limitPerMember:[0-9]*' admin-dist/assets/aiJob-*.js | head
REMOTE
