import { Router } from 'express';
import { prisma } from '../prisma.js';
import {
  verifyFeedAction,
  feedResultCard,
} from '../services/feishu.js';

const router = Router();

function htmlPage({ ok, title, detail }) {
  const color = ok ? '#0b6e4f' : '#b42318';
  const safeTitle = String(title || '').replace(/</g, '&lt;');
  const safeDetail = String(detail || '').replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f5f6f7; color: #1f2329; }
    .box { max-width: 480px; margin: 12vh auto; background: #fff; border-radius: 12px; padding: 28px 24px; box-shadow: 0 8px 28px rgba(0,0,0,.06); }
    h1 { font-size: 22px; margin: 0 0 12px; color: ${color}; }
    p { margin: 0; line-height: 1.6; color: #646a73; font-size: 15px; word-break: break-word; }
    .tip { margin-top: 18px; font-size: 13px; color: #8f959e; }
  </style>
</head>
<body>
  <div class="box">
    <h1>${safeTitle}</h1>
    <p>${safeDetail}</p>
    <p class="tip">可关闭此页，返回飞书继续处理下一条。</p>
  </div>
</body>
</html>`;
}

/**
 * 执行批准/拒绝，返回统一结果（HTML 与卡片回调共用）
 */
export async function applyFeedAction(postId, action) {
  const post = await prisma.feedPost.findUnique({
    where: { id: postId },
    include: { relatedMember: { select: { name: true, company: true } } },
  });
  if (!post) {
    return { ok: false, http: 404, title: '未找到动态', detail: '该条可能已被删除。', post: null };
  }

  if (action === 'approve') {
    if (post.status === 'published') {
      return {
        ok: true,
        http: 200,
        title: '已是发布状态',
        detail: `「${post.title}」此前已发布，无需重复操作。`,
        post,
      };
    }
    if (post.status === 'rejected') {
      return {
        ok: false,
        http: 409,
        title: '已拒绝，无法批准',
        detail: `「${post.title}」已被拒绝。如需发布请到管理后台重新编辑。`,
        post,
      };
    }
    const updated = await prisma.feedPost.update({
      where: { id: postId },
      data: { status: 'published' },
      include: { relatedMember: { select: { name: true, company: true } } },
    });
    return {
      ok: true,
      http: 200,
      title: '已批准并发布',
      detail: `「${post.title}」已对会员可见。`,
      post: updated,
    };
  }

  if (post.status === 'rejected') {
    return {
      ok: true,
      http: 200,
      title: '已是拒绝状态',
      detail: `「${post.title}」此前已拒绝。`,
      post,
    };
  }
  if (post.status === 'published') {
    return {
      ok: false,
      http: 409,
      title: '已发布，无法拒绝',
      detail: `「${post.title}」已发布。如需下架请到管理后台操作。`,
      post,
    };
  }
  const updated = await prisma.feedPost.update({
    where: { id: postId },
    data: { status: 'rejected' },
    include: { relatedMember: { select: { name: true, company: true } } },
  });
  return {
    ok: true,
    http: 200,
    title: '已拒绝',
    detail: `「${post.title}」不会展示给会员。`,
    post: updated,
  };
}

async function handleAction(req, res) {
  const { id, action } = req.params;
  const { exp, sig } = req.query || {};
  const check = verifyFeedAction(id, action, exp, sig);
  if (!check.ok) {
    return res.status(403).type('html').send(
      htmlPage({ ok: false, title: '操作失败', detail: check.message })
    );
  }

  try {
    const result = await applyFeedAction(id, action);
    return res.status(result.http || 200).type('html').send(
      htmlPage({
        ok: result.ok,
        title: result.title,
        detail: result.detail,
      })
    );
  } catch (err) {
    console.error('[feishu] action failed', err);
    return res.status(500).type('html').send(
      htmlPage({ ok: false, title: '服务器错误', detail: err.message || '请稍后重试' })
    );
  }
}

function parseActionValue(body) {
  // 新版 card.action.trigger
  const v1 = body?.event?.action?.value;
  if (v1 && typeof v1 === 'object') return v1;
  if (typeof v1 === 'string') {
    try {
      return JSON.parse(v1);
    } catch {
      /* ignore */
    }
  }
  // 旧版消息卡片
  const v0 = body?.action?.value;
  if (v0 && typeof v0 === 'object') return v0;
  if (typeof v0 === 'string') {
    try {
      return JSON.parse(v0);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function isNewCardCallback(body) {
  return (
    body?.header?.event_type === 'card.action.trigger' ||
    body?.schema === '2.0' ||
    Boolean(body?.event?.action)
  );
}

/**
 * 飞书应用：URL 校验 + 卡片回传（原地更新）
 * 回调地址：https://frontier-api.geekpark.net/api/feishu/card
 */
router.post('/card', async (req, res) => {
  const body = req.body || {};

  // URL 验证
  if (body.type === 'url_verification' || body.challenge) {
    const token = process.env.FEISHU_VERIFICATION_TOKEN;
    if (token && body.token && body.token !== token) {
      return res.status(403).json({ error: 'verification token mismatch' });
    }
    return res.json({ challenge: body.challenge });
  }

  // 可选：校验 Verification Token（新版在 header.token）
  const expectToken = process.env.FEISHU_VERIFICATION_TOKEN;
  const gotToken = body.token || body.header?.token;
  if (expectToken && gotToken && gotToken !== expectToken) {
    return res.status(403).json({ error: 'token mismatch' });
  }

  const value = parseActionValue(body);
  if (!value) {
    console.warn('[feishu] card callback: no action value', JSON.stringify(body).slice(0, 500));
    return res.status(200).json({});
  }

  const postId = value.postId || value.post_id || value.id;
  const action = value.action;
  const check = verifyFeedAction(postId, action, value.exp, value.sig);
  if (!check.ok) {
    const toast = { type: 'error', content: check.message };
    if (isNewCardCallback(body)) {
      return res.status(200).json({ toast });
    }
    return res.status(200).json({
      header: {
        template: 'red',
        title: { tag: 'plain_text', content: '操作失败' },
      },
      elements: [
        {
          tag: 'div',
          text: { tag: 'plain_text', content: check.message },
        },
      ],
    });
  }

  try {
    const result = await applyFeedAction(postId, action);
    const card = feedResultCard(result.post || { id: postId, title: '', content: '' }, {
      ok: result.ok,
      title: result.title,
      detail: result.detail,
    });
    const toast = {
      type: result.ok ? 'success' : 'error',
      content: result.title,
    };

    if (isNewCardCallback(body)) {
      return res.status(200).json({
        toast,
        card: { type: 'raw', data: card },
      });
    }
    // 旧版：直接回卡片 JSON
    return res.status(200).json(card);
  } catch (err) {
    console.error('[feishu] card callback failed', err);
    const toast = { type: 'error', content: err.message || '服务器错误' };
    if (isNewCardCallback(body)) {
      return res.status(200).json({ toast });
    }
    return res.status(200).json({
      header: {
        template: 'red',
        title: { tag: 'plain_text', content: '服务器错误' },
      },
      elements: [
        {
          tag: 'div',
          text: { tag: 'plain_text', content: err.message || '请稍后重试' },
        },
      ],
    });
  }
});

router.get('/feed/:id/approve', (req, res) => {
  req.params.action = 'approve';
  return handleAction(req, res);
});

router.get('/feed/:id/reject', (req, res) => {
  req.params.action = 'reject';
  return handleAction(req, res);
});

export default router;
