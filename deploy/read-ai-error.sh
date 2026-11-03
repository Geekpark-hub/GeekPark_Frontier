#!/bin/bash
set -euo pipefail
ssh -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@192.168.123.14 bash -s <<'REMOTE'
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
export DATABASE_URL="file:$REMOTE/data/prod.db"
node --input-type=module <<'NODE'
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const l = await p.jobLog.findFirst({ where: { type: 'ai_feed' }, orderBy: { createdAt: 'desc' } });
console.log('summary:', l?.summary);
console.log('detail:', l?.detail);
await p.$disconnect();
NODE
echo "=== polyfill present? ==="
head -5 src/index.js
ls -la src/polyfill-fetch.js node_modules/node-fetch/package.json
echo "=== log tail ==="
tail -n 30 frontier-api.log
REMOTE
