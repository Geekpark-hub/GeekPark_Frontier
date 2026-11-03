import { Router } from 'express';
import { prisma } from '../prisma.js';
import { requireBoundMember } from '../middleware/auth.js';
import { pageResult, parsePageQuery } from '../utils/pagination.js';

const router = Router();

function publicBrief(row, { withBody = false } = {}) {
  if (!row) return null;
  const base = {
    id: row.id,
    title: row.title,
    guestName: row.guestName || '',
    summary: row.summary || '',
    status: row.status,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
  if (withBody) {
    base.contentHtml = row.contentHtml || '';
  }
  return base;
}

router.get('/', requireBoundMember, async (req, res) => {
  const { page, pageSize, skip, take } = parsePageQuery(req.query);
  const where = { status: 'published' };
  const [total, rows] = await Promise.all([
    prisma.brief.count({ where }),
    prisma.brief.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
      select: {
        id: true,
        title: true,
        guestName: true,
        summary: true,
        status: true,
        publishedAt: true,
        createdAt: true,
      },
    }),
  ]);
  res.json(
    pageResult({
      rowsKey: 'briefs',
      rows: rows.map((r) => publicBrief(r)),
      total,
      page,
      pageSize,
    })
  );
});

router.get('/:id', requireBoundMember, async (req, res) => {
  const row = await prisma.brief.findUnique({ where: { id: req.params.id } });
  if (!row || row.status !== 'published') {
    return res.status(404).json({ error: '内参不存在或未发布' });
  }
  res.json({ brief: publicBrief(row, { withBody: true }) });
});

export default router;
