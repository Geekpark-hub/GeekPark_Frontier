#!/bin/bash
set -euo pipefail
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
LOG=/home/ubuntu/apps/frontier-society/frontier-api.log
echo "=== recent notify / register / feishu ==="
grep -E '\[notify\]|\[feishu\] event|/register|subscribe' "$LOG" | tail -60 || true
echo "=== last POST events register ==="
grep -E 'POST /api/events/.*/register' "$LOG" | tail -20 || true
echo "=== log tail ==="
tail -n 30 "$LOG"
REMOTE
