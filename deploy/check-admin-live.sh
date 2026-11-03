#!/bin/bash
set -euo pipefail
echo "===html==="
curl -sS https://frontier-api.geekpark.net/admin/ | head -c 800
echo
echo
echo "===cdn assets from html==="
html=$(curl -sS https://frontier-api.geekpark.net/admin/)
js=$(echo "$html" | grep -oE 'https://frontier\.geekpark\.net/frontier/admin/assets/[^"]+\.js' | head -1)
css=$(echo "$html" | grep -oE 'https://frontier\.geekpark\.net/frontier/admin/assets/[^"]+\.css' | head -1)
vendor=$(echo "$html" | grep -oE 'https://frontier\.geekpark\.net/frontier/admin/assets/vue-vendor[^"]+\.js' | head -1)
echo "js=$js"
echo "css=$css"
echo "vendor=$vendor"
curl -sS -o /dev/null -w "js=%{http_code} size=%{size_download}\n" "$js"
curl -sS -o /dev/null -w "css=%{http_code} size=%{size_download}\n" "$css"
curl -sS -o /dev/null -w "vendor=%{http_code} size=%{size_download}\n" "$vendor"
# probe a few lazy chunks that blank page often misses
for f in NotifyLogs-DXKcKJaY.js Login-CY1On7bF.js Layout-CuGLouBB.js; do
  curl -sS -o /dev/null -w "$f=%{http_code}\n" "https://frontier.geekpark.net/frontier/admin/assets/$f"
done
echo done
