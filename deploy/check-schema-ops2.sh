#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
export PATH="$REMOTE/.node/bin:$PATH"
cd "$REMOTE"
export DATABASE_URL="file:$REMOTE/data/prod.db"
node --input-type=module <<'NODE'
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const cols = await p.$queryRawUnsafe(`PRAGMA table_info(Member)`);
  const names = cols.filter((c) => /password/i.test(String(c.name))).map((c) => String(c.name));
  console.log('member_password_cols=' + names.join(','));
  const tables = await p.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%otify%'`
  );
  console.log('notify_tables=' + tables.map((x) => String(x.name)).join(','));
  const n = await p.notifyLog.count();
  console.log('notifyLog_count=' + n);
} finally {
  await p.$disconnect();
}
NODE
