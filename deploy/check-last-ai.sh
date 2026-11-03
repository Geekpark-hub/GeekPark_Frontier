#!/bin/bash
set -euo pipefail
cd /home/ubuntu/apps/frontier-society
set -a
. ./.env.production
set +a
export PATH="$PWD/.node/bin:$PATH"
export DATABASE_URL="file:$PWD/data/prod.db"

echo "=== recent job logs ==="
node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const jobs = await p.jobLog.findMany({
    where: { type: 'ai_feed' },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  for (const j of jobs) {
    let detail = {};
    try { detail = JSON.parse(j.detail || '{}'); } catch {}
    console.log(JSON.stringify({
      id: j.id,
      status: j.status,
      summary: j.summary,
      createdAt: j.createdAt,
      scanned: detail.scanned,
      created: detail.created,
      skipped: detail.skipped,
      rejected: detail.rejected,
      deadLinks: detail.deadLinks,
      errors: detail.errors,
      rssStatus: detail.rssStatus ? {
        pooled: detail.rssStatus.pooled,
        feeds: detail.rssStatus.feeds,
        feedStats: (detail.rssStatus.feedStats || []).map((f) => ({
          id: f.id, name: f.name, ok: f.ok, count: f.count, error: f.error,
        })),
      } : null,
      search: detail.searchStatus,
      llm: detail.llmStatus,
    }, null, 2));
    console.log('---');
  }
  const pending = await p.feedPost.count({ where: { status: 'pending', sourceType: 'auto' } });
  const published = await p.feedPost.count({ where: { status: 'published' } });
  console.log(JSON.stringify({ pendingAuto: pending, published }));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
NODE

echo "=== api log tail ==="
tail -n 40 frontier-api.log | sed 's/\x1b\[[0-9;]*m//g'
