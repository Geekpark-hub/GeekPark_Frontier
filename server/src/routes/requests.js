import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireActiveMember } from '../middleware/auth.js';
import { notifyRequestSubmitted } from '../services/feishu.js';

const router = Router();

router.get('/mine', requireActiveMember, async (req, res) => {
  try {
    const items = await prisma.request.findMany({
      where: { memberId: req.member.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      items: items.map((r) => ({
        id: r.id,
        content: r.content,
        startAt: r.startAt,
        endAt: r.endAt,
        location: r.location,
        connectWith: r.connectWith,
        status: r.status,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取需求失败' });
  }
});

router.post('/', requireActiveMember, async (req, res) => {
  try {
    const { content, startAt, endAt, location = '', connectWith = '' } = req.body || {};
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: '请填写需求内容' });
    }

    const item = await prisma.request.create({
      data: {
        memberId: req.member.id,
        content: String(content).trim(),
        startAt: startAt ? new Date(startAt) : null,
        endAt: endAt ? new Date(endAt) : null,
        location,
        connectWith,
        status: 'submitted',
      },
    });

    // 飞书推送异步进行，失败不影响会员提交结果
    notifyRequestSubmitted({ member: req.member, request: item }).catch((err) => {
      console.warn('[feishu] notify error', err.message || err);
    });

    res.json({
      request: {
        id: item.id,
        content: item.content,
        startAt: item.startAt,
        endAt: item.endAt,
        location: item.location,
        connectWith: item.connectWith,
        status: item.status,
        createdAt: item.createdAt,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '提交需求失败' });
  }
});

export default router;
