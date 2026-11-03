import { Router } from 'express';
import { requireMemberOrVisitor } from '../middleware/auth.js';
import { normalizeTrackPayload, recordActivityEvent } from '../services/analytics.js';

const router = Router();

/** 小程序埋点：单条或批量（访客仅记成功数，不落会员 id） */
router.post('/track', requireMemberOrVisitor, async (req, res) => {
  try {
    const body = req.body || {};
    const list = Array.isArray(body.events) ? body.events : [body];
    let saved = 0;
    const memberId = req.member?.id || null;
    for (const item of list.slice(0, 20)) {
      if (!normalizeTrackPayload(item)) continue;
      if (memberId) await recordActivityEvent(memberId, item, req);
      saved += 1;
    }
    res.json({ ok: true, saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '埋点失败' });
  }
});

export default router;
