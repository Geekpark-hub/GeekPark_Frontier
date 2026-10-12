import 'dotenv/config';
import { prisma } from '../src/prisma.js';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';

async function main() {
  const health = await (await fetch(`${BASE}/health`)).json();
  console.log('search', health.search);
  console.log('llm', health.llm);

  const member = await prisma.member.findFirst({ where: { phone: '13800000001' } });
  if (!member) throw new Error('seed member missing');

  const login = await (
    await fetch(`${BASE}/auth/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '17611294568' }),
    })
  ).json();

  const res = await fetch(`${BASE}/admin/ai/run-feed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${login.token}`,
    },
    body: JSON.stringify({ memberId: member.id, limitPerMember: 1 }),
  });
  const data = await res.json();
  console.log('http', res.status);
  console.log(JSON.stringify(data.result || data, null, 2));

  const post = await prisma.feedPost.findFirst({
    where: { relatedMemberId: member.id, sourceType: 'auto' },
    orderBy: { createdAt: 'desc' },
  });
  if (post) {
    console.log('sample title:', post.title);
    console.log('sample reason:', post.aiReason);
    console.log('sample content:', (post.content || '').slice(0, 220));
  }
}

main()
  .catch((err) => {
    console.error('FAILED', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
