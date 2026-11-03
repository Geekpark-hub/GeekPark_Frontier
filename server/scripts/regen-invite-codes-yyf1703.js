/**
 * 将现有会员 inviteCode 按「姓名拼音首字母 + 1703」重写（如 YYF1703）。
 * 用法：node scripts/regen-invite-codes-yyf1703.js
 * 已是新格式（末尾 1703）且唯一的会跳过。
 */
import 'dotenv/config';
import { prisma } from '../src/prisma.js';
import { allocateInviteCode, INVITE_CODE_SUFFIX } from '../src/utils/inviteCode.js';

function looksLikeNewFormat(code) {
  return typeof code === 'string' && code.endsWith(INVITE_CODE_SUFFIX) && /^[A-Z]+1703[A-Z0-9]*$/.test(code);
}

async function main() {
  const members = await prisma.member.findMany({
    select: { id: true, name: true, inviteCode: true, isAdmin: true },
    orderBy: { createdAt: 'asc' },
  });
  let updated = 0;
  let skipped = 0;
  for (const m of members) {
    if (looksLikeNewFormat(m.inviteCode)) {
      skipped += 1;
      continue;
    }
    const inviteCode = await allocateInviteCode(m.name, m.id);
    await prisma.member.update({ where: { id: m.id }, data: { inviteCode } });
    updated += 1;
    console.log(`${m.name}: ${m.inviteCode || '(empty)'} -> ${inviteCode}`);
  }
  console.log(JSON.stringify({ total: members.length, updated, skipped }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
