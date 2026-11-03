#!/bin/bash
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-qr-noborder.tgz ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
cd "$REMOTE"
rm -rf admin-dist
tar -xzf frontier-qr-noborder.tgz
test -f admin-dist/index.html
echo admin-dist ok
REMOTE