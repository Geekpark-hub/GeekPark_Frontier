import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireActiveMember } from '../middleware/auth.js';

const router = Router();

router.get('/', requireActiveMember, async (req, res) => {
  try {
    const now = new Date();
    const events = await prisma.event.findMany({
      where: { status: { in: ['published', 'closed'] } },
      orderBy: { startAt: 'desc' },
      include: {
        registrations: {
          where: { memberId: req.member.id },
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

router.get('/:id', requireActiveMember, async (req, res) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        registrations: {
          where: { memberId: req.member.id },
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
      status: 'pending',
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

    res.json({ registration: reg });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '报名失败' });
  }
});

function formatEvent(e) {
  return {
    id: e.id,
    title: e.title,
    coverUrl: e.coverUrl,
    description: e.description,
    location: e.location,
    agenda: e.agenda,
    guests: e.guests,
    startAt: e.startAt,
    endAt: e.endAt,
    registerDeadline: e.registerDeadline,
    status: e.status,
    myStatus: e.registrations?.[0]?.status || null,
  };
}

export default router;
