import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireActiveMember, requireMemberOrVisitor } from '../middleware/auth.js';
import { sendRegisterSuccessNotice } from '../services/notify.js';
import { notifyEventCancelled, notifyEventRegistered } from '../services/feishu.js';

const router = Router();

/** 信息流置顶活动：已发布且勾选展示、未结束 */
router.get('/feed-active', requireMemberOrVisitor, async (_req, res) => {
  try {
    const now = new Date();
    const events = await prisma.event.findMany({
      where: {
        status: 'published',
        showInFeed: true,
        endAt: { gte: now },
      },
      orderBy: { startAt: 'asc' },
      take: 20,
    });
    res.json({
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        coverUrl: e.coverUrl,
        showCoverInFeed: e.showCoverInFeed !== false,
        description: e.description,
        location: e.location,
        locationLat: e.locationLat,
        locationLng: e.locationLng,
        startAt: e.startAt,
        endAt: e.endAt,
        registerDeadline: e.registerDeadline,
        status: e.status,
        feedPin: Boolean(e.feedPin),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取信息流活动失败' });
  }
});

router.get('/', requireMemberOrVisitor, async (req, res) => {
  try {
    const now = new Date();
    const memberId = req.member?.id || '__none__';
    const events = await prisma.event.findMany({
      where: { status: { in: ['published', 'closed'] } },
      orderBy: { startAt: 'desc' },
      include: {
        registrations: {
          where: { memberId },
          select: { id: true, status: true },
        },
      },
    });

    const upcoming = [];
    const past = [];
    for (const e of events) {
      const item = formatEvent(e);
      if (e.endAt >= now && e.status === 'published') upcoming.push(item);
      else past.push(item);
    }
    upcoming.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

    res.json({ upcoming, past });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取活动失败' });
  }
});

router.get('/mine', requireActiveMember, async (req, res) => {
  try {
    const regs = await prisma.registration.findMany({
      where: { memberId: req.member.id },
      include: { event: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      items: regs.map((r) => ({
        id: r.id,
        status: r.status,
        name: r.name,
        willAttend: r.willAttend,
        companions: r.companions,
        specialNeeds: r.specialNeeds,
        event: formatEvent(r.event),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取我的活动失败' });
  }
});

router.get('/:id', requireMemberOrVisitor, async (req, res) => {
  try {
    const memberId = req.member?.id || '__none__';
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        registrations: {
          where: { memberId },
        },
      },
    });
    if (!event || event.status === 'draft') {
      return res.status(404).json({ error: '活动不存在' });
    }
    res.json({
      event: formatEvent(event),
      myRegistration: event.registrations[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取活动详情失败' });
  }
});

router.post('/:id/register', requireActiveMember, async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event || event.status !== 'published') {
      return res.status(400).json({ error: '活动不可报名' });
    }
    if (event.registerDeadline && new Date() > event.registerDeadline) {
      return res.status(400).json({ error: '报名已截止' });
    }

    const existing = await prisma.registration.findUnique({
      where: {
        eventId_memberId: { eventId: event.id, memberId: req.member.id },
      },
    });
    if (existing && existing.status !== 'cancelled') {
      return res.status(400).json({ error: '您已报名该活动' });
    }

    const { name, willAttend = true, companions = '', specialNeeds = '' } = req.body || {};
    const data = {
      name: name || req.member.name,
      willAttend: Boolean(willAttend),
      companions: companions || '',
      specialNeeds: specialNeeds || '',
      // 会员提交即算报名成功，后台可再改候补/取消；小程序不再展示「待审核」
      status: 'approved',
    };

    let reg;
    if (existing) {
      reg = await prisma.registration.update({
        where: { id: existing.id },
        data,
      });
    } else {
      reg = await prisma.registration.create({
        data: {
          eventId: event.id,
          memberId: req.member.id,
          ...data,
        },
      });
    }

    // 通知失败不影响报名结果
    sendRegisterSuccessNotice(req.member, event).catch((err) => {
      console.warn('[notify] register wx', err.message || err);
    });
    notifyEventRegistered({
      member: req.member,
      event,
      registration: reg,
    }).catch((err) => {
      console.warn('[notify] register feishu', err.message || err);
    });

    res.json({ registration: reg });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '报名失败' });
  }
});

router.post('/:id/cancel-register', requireActiveMember, async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event) return res.status(404).json({ error: '活动不存在' });
    const now = new Date();
    // 活动未结束前均可取消（含已开始）；结束后不可取消
    if (event.status === 'closed' || new Date(event.endAt) < now) {
      return res.status(400).json({ error: '活动已结束，无法取消报名' });
    }

    const existing = await prisma.registration.findUnique({
      where: {
        eventId_memberId: { eventId: event.id, memberId: req.member.id },
      },
    });
    if (!existing || existing.status === 'cancelled') {
      return res.status(400).json({ error: '您尚未报名该活动' });
    }

    const reg = await prisma.registration.update({
      where: { id: existing.id },
      data: { status: 'cancelled' },
    });

    notifyEventCancelled({
      member: req.member,
      event,
      registration: reg,
    }).catch((err) => {
      console.warn('[notify] cancel feishu', err.message || err);
    });

    res.json({ registration: reg });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '取消报名失败' });
  }
});

function formatEvent(e) {
  return {
    id: e.id,
    title: e.title,
    coverUrl: e.coverUrl,
    description: e.description,
    location: e.location,
    locationLat: e.locationLat,
    locationLng: e.locationLng,
    agenda: e.agenda,
    guests: e.guests,
    startAt: e.startAt,
    endAt: e.endAt,
    registerDeadline: e.registerDeadline,
    status: e.status,
    showInFeed: Boolean(e.showInFeed),
    showCoverInFeed: e.showCoverInFeed !== false,
    feedPin: Boolean(e.feedPin),
    myStatus: e.registrations?.[0]?.status || null,
  };
}

export default router;
