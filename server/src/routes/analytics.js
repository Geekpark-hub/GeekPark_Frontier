import { Router } from 'express';
import { requireActiveMember } from '../middleware/auth.js';
import { normalizeTrackPayload, recordActivityEvent } from '../services/analytics.js';

const router = Router();

/** 小程序埋点：单条或批量 */
router.post('/track', requireActiveMember, async (req, res) => {
  try {
    const body = req.body || {};
    const list = Array.isArray(body.events) ? body.events : [body];
    let saved = 0;
    for (const item of list.slice(0, 20)) {
      if (!normalizeTrackPayload(item)) continue;
      await recordActivityEvent(req.member.id, item, req);
      saved += 1;
    }
    res.json({ ok: true, saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '埋点失败' });
  }
});

export default router;
