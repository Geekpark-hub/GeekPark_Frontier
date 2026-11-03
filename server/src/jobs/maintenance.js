import { prisma } from '../prisma.js';
import { sendExpiryNotice, sendEventRemindNotice } from '../services/notify.js';
import { maintenanceAlertCard, sendFeishuCard } from '../services/feishu.js';

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}

/** 微信侧真实失败（可重试）；配置缺失/无 openid 等 log_only 视为跳过 */
function isHardNotifyFailure(result) {
  return Boolean(result && !result.sent && result.mode === 'wechat');
}

function isSoftSkip(result) {
  return Boolean(result && !result.sent && result.mode === 'log_only');
}

export async function runMaintenance() {
  const now = new Date();
  // 投票不再按 endAt 自动结束，需运营在后台点「结束」
  const endedPolls = { count: 0 };

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
  const eventRemind = await processEventReminders(now);

  const expiryOk = Math.max(0, (notice.noticed || 0) - (notice.failed || 0) - (notice.skipped || 0));
  const remindOk = Math.max(
    0,
    (eventRemind.noticed || 0) - (eventRemind.failed || 0) - (eventRemind.skipped || 0)
  );
  const failCount = (notice.failed || 0) + (eventRemind.failed || 0);
  const skipCount = (notice.skipped || 0) + (eventRemind.skipped || 0);
  const okCount = expiryOk + remindOk;

  // 文案刻意拆开三类动作，避免「到期 / 过期 / 跳过」挤在一起难懂
  const summary = [
    `状态改为已过期 ${expiredMembers.count} 人`,
    `会员到期订阅消息：成功 ${expiryOk} / 未推送 ${notice.skipped || 0} / 失败 ${notice.failed || 0}`,
    `活动开始订阅消息：成功 ${remindOk} / 未推送 ${eventRemind.skipped || 0} / 失败 ${eventRemind.failed || 0}`,
  ].join('；');

  let feishuAlert = null;
  // 微信硬失败 + 未推送（无 openid / 未配置模板等）都通知飞书群
  if (failCount > 0 || skipCount > 0) {
    feishuAlert = await alertNotifyFailuresToFeishu({
      summary,
      expiredMembers: expiredMembers.count,
      notice,
      eventRemind,
      expiryOk,
      remindOk,
      at: now,
    });
  }

  await prisma.jobLog.create({
    data: {
      type: 'maintenance',
      status: failCount > 0 || skipCount > 0 ? 'warn' : 'ok',
      summary,
      detail: JSON.stringify({
        endedPolls: endedPolls.count,
        expiredMembers: expiredMembers.count,
        notices: notice,
        eventRemind,
        feishuAlert,
        notifyOk: okCount,
        notifyFailed: failCount,
        notifySkipped: skipCount,
        at: now.toISOString(),
      }),
    },
  });

  return {
    endedPolls: endedPolls.count,
    expiredMembers: expiredMembers.count,
    notices: notice,
    eventRemind,
    feishuAlert,
    summary,
  };
}

function daysLeftLabel(daysLeft) {
  if (daysLeft == null) return '';
  if (daysLeft <= 0) return '已到到期日';
  return `还剩 ${daysLeft} 天`;
}

function toAlertRows(details, kind) {
  return (details || [])
    .filter((d) => (kind === 'fail' ? isHardNotifyFailure(d.sendResult) : isSoftSkip(d.sendResult)))
    .map((d) => ({
      name: d.name || d.memberName || d.memberId || '未知',
      tip: d.daysLeft != null ? daysLeftLabel(d.daysLeft) : d.eventTitle || '',
      reason: d.sendResult?.message || (kind === 'fail' ? '失败' : '未推送'),
    }));
}

async function alertNotifyFailuresToFeishu({
  expiredMembers,
  notice,
  eventRemind,
  expiryOk,
  remindOk,
  at,
}) {
  const card = maintenanceAlertCard({
    at,
    expiredMembers,
    expiryOk,
    expirySkipped: notice.skipped || 0,
    expiryFailed: notice.failed || 0,
    remindOk,
    remindSkipped: eventRemind.skipped || 0,
    remindFailed: eventRemind.failed || 0,
    expirySkipRows: toAlertRows(notice.details, 'skip'),
    expiryFailRows: toAlertRows(notice.details, 'fail'),
    remindSkipRows: toAlertRows(eventRemind.details, 'skip'),
    remindFailRows: toAlertRows(eventRemind.details, 'fail'),
  });

  try {
    const result = await sendFeishuCard(card);
    if (!result?.sent) {
      console.warn('[maintenance] feishu alert not sent', result?.message || result);
    }
    return result;
  } catch (err) {
    console.warn('[maintenance] feishu alert failed', err.message || err);
    return { sent: false, message: err.message || String(err) };
  }
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
  let failed = 0;
  let skipped = 0;
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
    const hardFail = isHardNotifyFailure(sendResult);
    const soft = isSoftSkip(sendResult);

    // 微信硬失败不推进 stage，下次维护可重试；成功或配置类跳过则推进
    if (!hardFail) {
      await prisma.member.update({
        where: { id: member.id },
        data: {
          expiryNoticeStage: stage,
          lastExpiryNoticeAt: now,
        },
      });
    }

    noticed += 1;
    if (hardFail) failed += 1;
    if (soft) skipped += 1;
    details.push({
      memberId: member.id,
      name: member.name,
      daysLeft,
      stage,
      sendResult,
      marked: !hardFail,
    });
  }

  return { noticed, failed, skipped, details };
}

/** 未来 24 小时内开始的已发布活动：对已报名会员发一次开始前提醒 */
async function processEventReminders(now) {
  const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const regs = await prisma.registration.findMany({
    where: {
      status: { in: ['approved', 'pending'] },
      eventReminderSentAt: null,
      event: {
        status: 'published',
        startAt: { gt: now, lte: until },
      },
      member: {
        openid: { not: null },
        isAdmin: false,
        isSuperAdmin: false,
      },
    },
    include: {
      event: true,
      member: true,
    },
    take: 200,
  });

  let noticed = 0;
  let failed = 0;
  let skipped = 0;
  const details = [];
  for (const reg of regs) {
    const sendResult = await sendEventRemindNotice(reg.member, reg.event);
    const hardFail = isHardNotifyFailure(sendResult);
    const soft = isSoftSkip(sendResult);

    if (!hardFail) {
      await prisma.registration.update({
        where: { id: reg.id },
        data: { eventReminderSentAt: now },
      });
    }

    noticed += 1;
    if (hardFail) failed += 1;
    if (soft) skipped += 1;
    details.push({
      registrationId: reg.id,
      eventId: reg.eventId,
      eventTitle: reg.event?.title || '',
      memberId: reg.memberId,
      memberName: reg.member?.name || '',
      sendResult,
      marked: !hardFail,
    });
  }
  return { noticed, failed, skipped, details };
}
