#!/bin/bash
set -euo pipefail
URL=https://frontier-api.geekpark.net/health

echo "=== sequential 20 from pub ==="
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{time_starttransfer} %{time_total}\n" -m 10 "$URL"
done | awk '{ttfb+=$1; tot+=$2; n++} END{printf "n=%d avg_ttfb=%.0fms avg_total=%.0fms\n", n, ttfb/n*1000, tot/n*1000}'

echo "=== concurrent 50 from pub ==="
rm -f /tmp/fb_*.txt
for i in $(seq 1 50); do
  (curl -s -o /dev/null -w "%{http_code} %{time_total}\n" -m 15 "$URL" > /tmp/fb_$i.txt) &
done
wait
cat /tmp/fb_*.txt | awk '{
  code=$1; t=$2; n++;
  if(code==200){ok++; sum+=t; times[ok]=t}
} END{
  ntmp=asort(times);
  p95=times[int((ok>0?ok:1)*0.95)];
  max=times[ok];
  printf "success=%d/%d avg=%.0fms p95=%.0fms max=%.0fms\n", ok,n, (ok?sum/ok*1000:0), p95*1000, max*1000
}'

echo "=== concurrent 100 from pub ==="
rm -f /tmp/fb_*.txt
for i in $(seq 1 100); do
  (curl -s -o /dev/null -w "%{http_code} %{time_total}\n" -m 15 "$URL" > /tmp/fb_$i.txt) &
done
wait
cat /tmp/fb_*.txt | awk '{
  code=$1; t=$2; n++;
  if(code==200){ok++; sum+=t; times[ok]=t}
} END{
  asort(times);
  p95=times[int((ok>0?ok:1)*0.95)];
  max=times[ok];
  printf "success=%d/%d avg=%.0fms p95=%.0fms max=%.0fms\n", ok,n, (ok?sum/ok*1000:0), p95*1000, max*1000
}'

echo "=== admin html + js from pub ==="
curl -s -o /dev/null -w "html ttfb=%{time_starttransfer}s total=%{time_total}s size=%{size_download}\n" -m 20 https://frontier-api.geekpark.net/
curl -s -o /dev/null -w "js   ttfb=%{time_starttransfer}s total=%{time_total}s size=%{size_download}\n" -m 30 https://frontier-api.geekpark.net/assets/index-DmKdUNP3.js

echo "=== galaxy local health ==="
curl -s -o /dev/null -w "local ttfb=%{time_starttransfer}s total=%{time_total}s\n" -m 5 http://192.168.123.14:3100/health
