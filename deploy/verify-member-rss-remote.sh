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
export DATABASE_URL="file:$REMOTE/data/prod.db"
node --input-type=module <<'JS'
import { prisma } from './src/prisma.js';
const sources = await prisma.newsSource.findMany({
  orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
  select: { key: true, name: true, url: true, enabled: true },
});
const extraKeys = [
  '36kr-article', 'tmtpost', 'jiqizhixin', 'qbitai', 'technode',
  'techcrunch-ai', 'techcrunch-startups', 'arstechnica-ai', 'bloomberg', 'bloomberg-tech',
];
const have = new Set(sources.map((s) => s.key));
console.log(JSON.stringify({
  sourceCount: sources.length,
  extrasPresent: extraKeys.filter((k) => have.has(k)),
  extrasMissing: extraKeys.filter((k) => !have.has(k)),
}, null, 2));
await prisma.$disconnect();
JS
REMOTE
