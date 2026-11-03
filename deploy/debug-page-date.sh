#!/bin/bash
set -euo pipefail
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
set -a
. ./.env.production
set +a
node --input-type=module <<'JS'
import { fetchArticlePage } from './src/services/pageFetch.js';

const urls = [
  'https://www.geekpark.net/news/372196',
  'https://www.huxiu.com/article/4896117.html',
  'https://www.wenxuan.news/dianxinyuhulian/21234.html',
];

for (const url of urls) {
  const page = await fetchArticlePage(url, { timeoutMs: 15000 });
  console.log(JSON.stringify({
    url,
    ok: page.ok,
    reason: page.reason || null,
    status: page.status || null,
    publishedAt: page.publishedAt || null,
    title: (page.title || '').slice(0, 60),
    finalUrl: page.finalUrl || null,
  }, null, 2));
}
JS
REMOTE
