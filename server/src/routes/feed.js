import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireActiveMember } from '../middleware/auth.js';

const router = Router();

router.get('/', requireActiveMember, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 10, 1), 30);
    const where = { status: 'published' };
    const skip = (page - 1) * pageSize;

    const [posts, total] = await Promise.all([
      prisma.feedPost.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.feedPost.count({ where }),
    ]);

    res.json({
      posts,
      page,
      pageSize,
      total,
      hasMore: skip + posts.length < total,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取动态失败' });
  }
});

export default router;
