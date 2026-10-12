import { prisma } from '../prisma.js';
import { sendExpiryNotice } from '../services/notify.js';

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}

export async function runMaintenance() {
  const now = new Date();
  const endedPolls = await prisma.poll.updateMany({
    where: {
      status: 'published',
      endAt: { lt: now },
    },
    data: { status: 'ended' },
  });

  const expiredMembers = await prisma.member.updateMany({
    where: {
      status: { not: 'expired' },
      expiresAt: { lt: now },
      isAdmin: false,
      isSuperAdmin: false,
    },
    data: { status: 'expired' },
  });

  const notice = await processExpiryNotices(now);

  const summary = `投票结束 ${endedPolls.count}，会员过期 ${expiredMembers.count}，到期提醒 ${notice.noticed}`;
  await prisma.jobLog.create({
    data: {
      type: 'maintenance',
      status: 'ok',
      summary,
      detail: JSON.stringify({
        endedPolls: endedPolls.count,
        expiredMembers: expiredMembers.count,
        notices: notice,
        at: now.toISOString(),
      }),
    },
  });

  return {
    endedPolls: endedPolls.count,
    expiredMembers: expiredMembers.count,
    notices: notice,
    summary,
  };
}

async function processExpiryNotices(now) {
  const members = await prisma.member.findMany({
    where: {
      expiresAt: { not: null },
      status: { in: ['active', 'pending', 'expired'] },
      isAdmin: false,
      isSuperAdmin: false,
    },
  });

  let noticed = 0;
  const details = [];

  for (const member of members) {
    if (!member.expiresAt) continue;
    const daysLeft = daysBetween(member.expiresAt, now);
    let stage = '';
    if (daysLeft <= 0) stage = '0';
    else if (daysLeft <= 3) stage = '3';
    else if (daysLeft <= 7) stage = '7';
    else continue;

    if (member.expiryNoticeStage === stage) continue;

    const sendResult = await sendExpiryNotice(member, { daysLeft });
    await prisma.member.update({
      where: { id: member.id },
      data: {
        expiryNoticeStage: stage,
        lastExpiryNoticeAt: now,
      },
    });
    noticed += 1;
    details.push({
      memberId: member.id,
      name: member.name,
      daysLeft,
      stage,
      sendResult,
    });
  }

  return { noticed, details };
}
