#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
cd "$REMOTE"

echo "===asset check==="
ls admin-dist/assets/NotifyLogs*.js 2>/dev/null | head -3 || ls admin-dist/assets/ | grep -i notify | head -5
ls admin-dist/assets/Analytics*.js 2>/dev/null | head -3
grep -l "notify\|消息" admin-dist/assets/Layout*.js 2>/dev/null | head -2 || true
grep -n "notify-logs\|analytics/export\|admin-password\|hasAdminPassword" src/routes/admin.js src/routes/auth.js | head -30

echo "===schema==="
sqlite3 data/prod.db ".schema NotifyLog" 2>/dev/null | head -20 || echo "no_sqlite3_or_table"
sqlite3 data/prod.db "PRAGMA table_info(Member);" 2>/dev/null | grep -i password || echo "check_member_cols"

echo "===http==="
curl -sf -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:3100/api/health
curl -sf -o /dev/null -w "admin_html=%{http_code}\n" http://127.0.0.1:3100/admin/ || true
curl -sf -o /dev/null -w "notify_logs_noauth=%{http_code}\n" http://127.0.0.1:3100/api/admin/notify-logs || true
curl -sf -o /dev/null -w "analytics_export_noauth=%{http_code}\n" "http://127.0.0.1:3100/api/admin/analytics/export?from=2026-01-01&to=2026-12-31" || true
echo smoke_ok
