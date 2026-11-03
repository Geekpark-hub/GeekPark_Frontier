import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ensureWxUrlLink } from '../services/shareLink.js';

const router = Router();

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: "PingFang SC", "Noto Sans SC", sans-serif; margin: 0; padding: 48px 24px;
      background: #f4f6f8; color: #14202b; text-align: center; }
    .card { max-width: 420px; margin: 0 auto; background: #fff; border-radius: 14px;
      padding: 28px 24px; box-shadow: 0 12px 32px rgba(20,32,43,.06); }
    h1 { font-size: 18px; margin: 0 0 12px; }
    p { margin: 0; font-size: 14px; line-height: 1.6; color: #6d7883; }
  </style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

async function redirectShare(res, { kind, id, pagePath, notFound }) {
  const select = { id: true };
  const row =
    kind === 'poll'
      ? await prisma.poll.findUnique({ where: { id }, select })
      : kind === 'brief'
        ? await prisma.brief.findUnique({ where: { id }, select })
        : await prisma.event.findUnique({ where: { id }, select });
  if (!row) {
    return res
      .status(404)
      .type('html')
      .send(htmlPage('未找到', `<h1>${notFound}</h1><p>链接可能已失效，请联系管理员重新获取。</p>`));
  }
  try {
    const ensured = await ensureWxUrlLink({ kind, id, pagePath, forceRefresh: false });
    return res.redirect(302, ensured.wxUrlLink);
  } catch (err) {
    console.warn(`[share/${kind}]`, err.detail || err.message || err);
    const msg =
      err.detail?.errcode === 85079
        ? '外部分享短链需要小程序已发布正式版。请使用后台生成的小程序码（体验成员可扫）。'
        : err.message || '暂时无法打开，请稍后重试';
    return res
      .status(400)
      .type('html')
      .send(htmlPage('无法打开', `<h1>无法打开分享链接</h1><p>${msg}</p>`));
  }
}

router.get('/e/:id', async (req, res) => {
  await redirectShare(res, {
    kind: 'event',
    id: req.params.id,
    pagePath: 'pages/events/share',
    notFound: '活动不存在',
  });
});

router.get('/p/:id', async (req, res) => {
  await redirectShare(res, {
    kind: 'poll',
    id: req.params.id,
    pagePath: 'pages/poll/share',
    notFound: '投票不存在',
  });
});

router.get('/b/:id', async (req, res) => {
  await redirectShare(res, {
    kind: 'brief',
    id: req.params.id,
    pagePath: 'pages/briefs/share',
    notFound: '内参不存在',
  });
});

export default router;
