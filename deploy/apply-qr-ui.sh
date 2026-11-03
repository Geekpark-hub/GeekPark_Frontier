#!/bin/bash
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-qr-ui.tgz ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
cd /home/ubuntu/apps/frontier-society
rm -rf admin-dist
tar -xzf frontier-qr-ui.tgz
test -f admin-dist/index.html
ls admin-dist/assets/Events-*.css | head -1
REMOTE