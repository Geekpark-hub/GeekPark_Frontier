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
const logs = await prisma.jobLog.findMany({
  where: { type: 'ai_feed' },
  orderBy: { createdAt: 'desc' },
  take: 5,
});
for (const log of logs) {
  let d = {};
  try { d = JSON.parse(log.detail || '{}'); } catch {}
  const started = d.startedAt ? new Date(d.startedAt).getTime() : null;
  const finished = d.finishedAt ? new Date(d.finishedAt).getTime() : (log.createdAt ? new Date(log.createdAt).getTime() : null);
  const sec = started && finished ? Math.round((finished - started) / 1000) : null;
  console.log(JSON.stringify({
    id: log.id,
    status: log.status,
    summary: log.summary,
    createdAt: log.createdAt,
    durationSec: sec,
    scanned: d.scanned,
    created: d.created,
    skipped: d.skipped,
    rejected: d.rejected,
    deadLinks: d.deadLinks,
    errors: (d.errors || []).length,
    rejectByReason: d.rejectByReason,
  }, null, 2));
  console.log('---');
}
await prisma.$disconnect();
JS
REMOTE
