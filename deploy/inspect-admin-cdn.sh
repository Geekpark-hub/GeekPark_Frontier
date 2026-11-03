#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
cd "$REMOTE"
echo "===index.html==="
cat admin-dist/index.html
echo
echo "===asset sample==="
ls admin-dist/assets | head -20
echo "count=$(ls admin-dist/assets | wc -l)"
echo
echo "===env==="
grep -E 'ADMIN|CDN|DIST|QINIU|STATIC' .env.production 2>/dev/null || true
echo
echo "===curl assets from local==="
JS=$(grep -oE '/assets/[^"]+\.js' admin-dist/index.html | head -1)
CSS=$(grep -oE '/assets/[^"]+\.css' admin-dist/index.html | head -1 || true)
echo "js_ref=$JS"
curl -sf -o /dev/null -w "local_js=%{http_code}\n" "http://127.0.0.1:3100$JS" || echo "local_js_fail"
if [ -n "${CSS:-}" ]; then
  curl -sf -o /dev/null -w "local_css=%{http_code}\n" "http://127.0.0.1:3100$CSS" || echo "local_css_fail"
fi
CDN_JS=$(grep -oE 'https://[^"]+/assets/[^"]+\.js' admin-dist/index.html | head -1 || true)
echo "cdn_js_ref=$CDN_JS"
if [ -n "$CDN_JS" ]; then
  curl -sf -o /dev/null -w "cdn_js=%{http_code}\n" "$CDN_JS" || echo "cdn_js_fail"
fi
echo
echo "===public admin==="
curl -sf -o /tmp/admin-index.html -w "public_admin=%{http_code}\n" https://frontier-api.geekpark.net/admin/ || true
head -c 500 /tmp/admin-index.html 2>/dev/null || true
echo
