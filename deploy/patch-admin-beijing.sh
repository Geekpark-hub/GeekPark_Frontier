#!/bin/bash
set -euo pipefail
GALAXY=ubuntu@192.168.123.14
REMOTE=/home/ubuntu/apps/frontier-society
scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/admin-dist-only.tgz "$GALAXY:/tmp/"
ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$GALAXY" bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
cd "$REMOTE"
rm -rf admin-dist
tar -xzf /tmp/admin-dist-only.tgz
head -n 16 admin-dist/index.html
echo patch_admin_beijing_ok
REMOTE
