#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
cd "$REMOTE"
echo "===local index==="
cat admin-dist/index.html
echo
echo "===local analyticsPdf==="
ls -la admin-dist/assets/analyticsPdf*.js 2>/dev/null || echo missing_local_analyticsPdf
ls -la admin-dist/assets/Analytics*.js 2>/dev/null || true
echo
echo "===public html==="
curl -sS https://frontier-api.geekpark.net/admin/ | tee /tmp/admin-live.html | head -c 900
echo
echo
JS=$(grep -oE 'https://frontier\.geekpark\.net/frontier/admin/assets/index-[^"]+\.js' /tmp/admin-live.html | head -1)
echo "entry_js=$JS"
curl -sS -o /dev/null -w "entry=%{http_code} size=%{size_download}\n" "$JS"
# from local dist, check analyticsPdf on CDN
LOCAL_PDF=$(basename "$(ls admin-dist/assets/analyticsPdf*.js | head -1)")
echo "cdn_pdf_url=https://frontier.geekpark.net/frontier/admin/assets/$LOCAL_PDF"
curl -sS -o /dev/null -w "cdn_pdf=%{http_code} size=%{size_download}\n" "https://frontier.geekpark.net/frontier/admin/assets/$LOCAL_PDF"
LOCAL_AN=$(basename "$(ls admin-dist/assets/Analytics-*.js | head -1)")
curl -sS -o /dev/null -w "cdn_analytics=%{http_code} size=%{size_download}\n" "https://frontier.geekpark.net/frontier/admin/assets/$LOCAL_AN"
echo done
