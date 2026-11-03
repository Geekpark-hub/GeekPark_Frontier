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

// 优先找：非管理员、已有用户码、未绑微信
let m = await p.member.findFirst({
  where: {
    isAdmin: false,
    isSuperAdmin: false,
    inviteCode: { not: null },
    openid: null,
  },
  select: {
    id: true, name: true, inviteCode: true, phone: true,
    openid: true, phoneAuthAskedAt: true, phoneAuthResult: true, status: true,
  },
});

if (!m) {
  m = await p.member.findFirst({
    where: {
      isAdmin: false,
      isSuperAdmin: false,
      inviteCode: { not: null },
    },
    select: {
      id: true, name: true, inviteCode: true, phone: true,
      openid: true, phoneAuthAskedAt: true, phoneAuthResult: true, status: true,
    },
  });
}

if (!m) {
  console.log(JSON.stringify({ error: 'no_member' }));
  await p.$disconnect();
  process.exit(1);
}

const updated = await p.member.update({
  where: { id: m.id },
  data: {
    phone: null,
    openid: null,
    phoneAuthAskedAt: null,
    phoneAuthResult: '',
    status: 'active',
  },
  select: {
    id: true, name: true, inviteCode: true, phone: true,
    openid: true, phoneAuthAskedAt: true, phoneAuthResult: true, status: true,
  },
});

console.log(JSON.stringify({
  ok: true,
  tip: '用下方用户码在小程序门禁验证；成功后应出现授权手机号',
  before: m,
  after: updated,
}, null, 2));

await p.$disconnect();
NODE
