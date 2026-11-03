import { Router } from 'express';
import { requireActiveMember } from '../middleware/auth.js';
import { getSubscribeTemplateIds, getMemberSubscribeQuota } from '../services/notify.js';

const router = Router();

/** 小程序拉订阅消息模板 ID（非密钥） */
router.get('/templates', (_req, res) => {
  const ids = getSubscribeTemplateIds();
  res.json({
    templates: ids,
    tmplIds: [ids.expiry, ids.register, ids.eventRemind].filter(Boolean),
  });
});

/** 估算各模板剩余推送机会（授权 − 已成功发送） */
router.get('/quota', requireActiveMember, async (req, res) => {
  try {
    const quota = await getMemberSubscribeQuota(req.member.id);
    res.json(quota);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '查询订阅额度失败' });
  }
});

export default router;
