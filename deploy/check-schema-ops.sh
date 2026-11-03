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
  const pwd = cols.filter(c => /password/i.test(c.name));
  console.log('member_password_cols', JSON.stringify(pwd));
  const tables = await p.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%otify%'`);
  console.log('notify_tables', JSON.stringify(tables));
  const n = await p.notifyLog.count().catch(e => ({ err: e.message }));
  console.log('notifyLog_count', n);
} finally {
  await p.$disconnect();
}
NODE
