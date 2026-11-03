#!/bin/bash
set -euo pipefail
cd /home/ubuntu/apps/frontier-society
set -a
. ./.env.production
set +a
export PATH="$PWD/.node/bin:$PATH"
export DATABASE_URL="file:$PWD/data/prod.db"

node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const total = await p.member.count();
  const active = await p.member.count({ where: { status: 'active' } });
  const withOpenid = await p.member.count({ where: { NOT: { openid: null } } });
  const admins = await p.member.count({
    where: { OR: [{ isAdmin: true }, { isSuperAdmin: true }] },
  });
  const published = await p.feedPost.count({ where: { status: 'published' } });
  const pending = await p.feedPost.count({ where: { status: 'pending' } });
  const phones = await p.member.findMany({
    select: {
      name: true,
      phone: true,
      status: true,
      openid: true,
      isAdmin: true,
      isSuperAdmin: true,
      company: true,
    },
    take: 30,
  });
  console.log(
    JSON.stringify(
      {
        total,
        active,
        withOpenid,
        admins,
        published,
        pending,
        phones: phones.map((m) => ({
          name: m.name,
          phone: m.phone
            ? `${String(m.phone).slice(0, 3)}****${String(m.phone).slice(-4)}`
            : '',
          status: m.status,
          hasOpenid: Boolean(m.openid),
          staff: Boolean(m.isAdmin || m.isSuperAdmin),
          company: m.company,
        })),
      },
      null,
      2
    )
  );
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
