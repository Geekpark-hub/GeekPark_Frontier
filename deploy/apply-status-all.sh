#!/bin/bash
set -euo pipefail
scp -o BatchMode=yes -o StrictHostKeyChecking=no /tmp/frontier-status-all.tgz ubuntu@192.168.123.14:/home/ubuntu/apps/frontier-society/
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 'cd /home/ubuntu/apps/frontier-society && rm -rf admin-dist && tar -xzf frontier-status-all.tgz && test -f admin-dist/index.html && echo ok'