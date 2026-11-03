#!/bin/bash
set -euo pipefail
REMOTE=/home/ubuntu/apps/frontier-society
cd "$REMOTE"
set -a
. ./.env.production
set +a
export DATABASE_URL="file:$REMOTE/data/prod.db"
export PATH="$REMOTE/.node/bin:$PATH"

node --input-type=module <<'NODE'
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const now = new Date();

const targets = await p.member.findMany({
  where: {
    isAdmin: false,
    isSuperAdmin: false,
    NOT: { phone: null },
  },
  select: { id: true, name: true, phone: true },
});

console.log('clear_targets', targets.length);
for (const m of targets) {
  console.log('-', m.name, m.phone);
}

const result = await p.member.updateMany({
  where: {
    isAdmin: false,
    isSuperAdmin: false,
    NOT: { phone: null },
  },
  data: {
    phone: null,
    // 已是老会员：清假号后不重复弹授权（仅首次用户码成功才弹）
    phoneAuthAskedAt: now,
    phoneAuthResult: 'reject',
  },
});

const left = await p.member.count({
  where: { isAdmin: false, isSuperAdmin: false, NOT: { phone: null } },
});
const staffPhones = await p.member.findMany({
  where: {
    OR: [{ isAdmin: true }, { isSuperAdmin: true }],
    NOT: { phone: null },
  },
  select: { name: true, phone: true, isAdmin: true, isSuperAdmin: true },
});

console.log(JSON.stringify({
  updated: result.count,
  memberPhonesLeft: left,
  staffPhonesKept: staffPhones,
}, null, 2));

await p.$disconnect();
NODE
