import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireMemberOrVisitor } from '../middleware/auth.js';
import { getFeedHeroSetting } from '../services/appSettings.js';

const router = Router();

/** 小程序动态页头图（开/关 + URL）；关闭时不返回默认图，由前端隐藏 */
router.get('/hero', requireMemberOrVisitor, async (_req, res) => {
  try {
    const hero = await getFeedHeroSetting();
    res.json({
      enabled: Boolean(hero.enabled),
      url: hero.enabled ? String(hero.url || '').trim() : '',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '获取动态页封面失败' });
  }
});

router.get('/', requireMemberOrVisitor, async (req, res) => {
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
