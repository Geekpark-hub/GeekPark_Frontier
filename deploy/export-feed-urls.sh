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
const rows = await prisma.feedPost.findMany({
  select: { id: true, sourceUrl: true, publishedAt: true },
  orderBy: { createdAt: 'desc' },
});
process.stdout.write(JSON.stringify(rows));
await prisma.$disconnect();
JS
REMOTE
