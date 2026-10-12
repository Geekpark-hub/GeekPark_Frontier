import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireActiveMember } from '../middleware/auth.js';

const router = Router();

router.get('/active', requireActiveMember, async (req, res) => {
  try {
    const now = new Date();
    const polls = await prisma.poll.findMany({
      where: {
        status: 'published',
        startAt: { lte: now },
        endAt: { gte: now },
      },
      include: {
        options: { orderBy: { sort: 'asc' } },
        votes: { where: { memberId: req.member.id }, select: { optionId: true } },
      },
      orderBy: { endAt: 'asc' },
    });

    res.json({
      polls: polls.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        multiSelect: p.multiSelect,
        startAt: p.startAt,
        endAt: p.endAt,
        status: p.status,
        options: p.options.map((o) => ({ id: o.id, text: o.text })),
        myOptionIds: p.votes.map((v) => v.optionId),
        hasVoted: p.votes.length > 0,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取投票失败' });
  }
});

router.get('/mine', requireActiveMember, async (req, res) => {
  try {
    const votes = await prisma.vote.findMany({
      where: { memberId: req.member.id },
      include: {
        poll: { include: { options: { orderBy: { sort: 'asc' } } } },
        option: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const byPoll = new Map();
    for (const v of votes) {
      if (!byPoll.has(v.pollId)) {
        byPoll.set(v.pollId, {
          poll: {
            id: v.poll.id,
            title: v.poll.title,
            description: v.poll.description,
            status: v.poll.status,
            endAt: v.poll.endAt,
            multiSelect: v.poll.multiSelect,
          },
          options: [],
          votedAt: v.createdAt,
        });
      }
      byPoll.get(v.pollId).options.push({ id: v.option.id, text: v.option.text });
    }

    res.json({ items: Array.from(byPoll.values()) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取我的投票失败' });
  }
});

router.get('/:id', requireActiveMember, async (req, res) => {
  try {
    const poll = await prisma.poll.findUnique({
      where: { id: req.params.id },
      include: {
        options: { orderBy: { sort: 'asc' } },
        votes: true,
      },
    });
    if (!poll || (poll.status === 'draft' && !req.member.isAdmin)) {
      return res.status(404).json({ error: '投票不存在' });
    }

    const myVotes = poll.votes.filter((v) => v.memberId === req.member.id);
    const canSeeResults = poll.status === 'ended' || myVotes.length > 0 || req.member.isAdmin;

    let results = null;
    let voters = null;
    if (canSeeResults) {
      const totalMembers = await prisma.member.count({ where: { status: 'active' } });
      const voterIds = new Set(poll.votes.map((v) => v.memberId));
      results = {
        totalVotes: poll.votes.length,
        votedCount: voterIds.size,
        unvotedCount: Math.max(totalMembers - voterIds.size, 0),
        options: poll.options.map((o) => {
          const count = poll.votes.filter((v) => v.optionId === o.id).length;
          return {
            id: o.id,
            text: o.text,
            count,
            ratio: voterIds.size ? Math.round((count / voterIds.size) * 100) : 0,
          };
        }),
      };

      if (poll.showVoters) {
        const votesWithMember = await prisma.vote.findMany({
          where: { pollId: poll.id },
          include: {
            member: { select: { id: true, name: true, company: true } },
            option: { select: { text: true } },
          },
          orderBy: { createdAt: 'asc' },
        });
        voters = votesWithMember.map((v) => ({
          memberId: v.member.id,
          name: v.member.name,
          company: v.member.company,
          optionText: v.option.text,
          createdAt: v.createdAt,
        }));
      }
    }

    // 时间已过但状态尚未被定时任务刷成 ended 时，对前端按已结束处理
    const effectiveStatus =
      poll.status === 'published' && new Date() > poll.endAt ? 'ended' : poll.status;

    res.json({
      poll: {
        id: poll.id,
        title: poll.title,
        description: poll.description,
        multiSelect: poll.multiSelect,
        startAt: poll.startAt,
        endAt: poll.endAt,
        status: effectiveStatus,
        showVoters: poll.showVoters,
        options: poll.options.map((o) => ({ id: o.id, text: o.text })),
        myOptionIds: myVotes.map((v) => v.optionId),
        hasVoted: myVotes.length > 0,
        results,
        voters,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取投票详情失败' });
  }
});

router.post('/:id/vote', requireActiveMember, async (req, res) => {
  try {
    const { optionIds } = req.body || {};
    if (!Array.isArray(optionIds) || optionIds.length === 0) {
      return res.status(400).json({ error: '请选择选项' });
    }

    const poll = await prisma.poll.findUnique({
      where: { id: req.params.id },
      include: { options: true, votes: { where: { memberId: req.member.id } } },
    });

    if (!poll || poll.status !== 'published') {
      return res.status(400).json({ error: '投票不可用' });
    }

    const now = new Date();
    if (now < poll.startAt || now > poll.endAt) {
      return res.status(400).json({ error: '不在投票时间范围内' });
    }

    if (poll.votes.length > 0) {
      return res.status(400).json({ error: '您已投过票，不可修改' });
    }

    if (!poll.multiSelect && optionIds.length > 1) {
      return res.status(400).json({ error: '该投票为单选' });
    }

    const validIds = new Set(poll.options.map((o) => o.id));
    if (optionIds.some((id) => !validIds.has(id))) {
      return res.status(400).json({ error: '选项无效' });
    }

    await prisma.vote.createMany({
      data: optionIds.map((optionId) => ({
        pollId: poll.id,
        optionId,
        memberId: req.member.id,
      })),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '投票失败' });
  }
});

export default router;
