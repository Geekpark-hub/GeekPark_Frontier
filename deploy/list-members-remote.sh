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
const rows = await prisma.member.findMany({
  where: { isAdmin: false, isSuperAdmin: false },
  select: { id: true, name: true, company: true, phone: true },
  orderBy: { name: 'asc' },
});
console.log(JSON.stringify(rows, null, 2));
await prisma.$disconnect();
JS
REMOTE
