#!/bin/bash
set -e
echo "==== ssl.conf ===="
cat /etc/nginx/ssl.conf 2>/dev/null || echo missing
echo "==== sample cert refs ===="
grep -n ssl_certificate /etc/nginx/sites-enabled/gpk-main /etc/nginx/sites-enabled/frontier.pc 2>/dev/null | head -20
echo "==== galaxy ===="
ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no ubuntu@192.168.123.14 'hostname; free -h | head -2; df -h / | tail -1; docker ps --format "{{.Names}} {{.Ports}}" | head; ss -lntp | head -20'
