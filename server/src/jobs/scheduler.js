import cron from 'node-cron';
import { runMaintenance } from './maintenance.js';
import { runAiFeed } from './aiFeed.js';

let started = false;

export function startScheduler() {
  if (started) return;
  started = true;

  const enableJobs = String(process.env.ENABLE_JOBS || 'true').toLowerCase() !== 'false';
  if (!enableJobs) {
    console.log('[jobs] disabled by ENABLE_JOBS=false');
    return;
  }

  // 每小时：结束过期投票、标记过期会员、到期提醒
  cron.schedule(process.env.CRON_MAINTENANCE || '5 * * * *', async () => {
    try {
      const result = await runMaintenance();
      console.log('[jobs] maintenance', result.summary);
    } catch (err) {
      console.error('[jobs] maintenance failed', err);
    }
  });

  // 每天 8:30：AI 抓取（无 Key 时走 mock）
  cron.schedule(process.env.CRON_AI_FEED || '30 8 * * *', async () => {
    try {
      const result = await runAiFeed();
      console.log('[jobs] ai_feed', result.summary);
    } catch (err) {
      console.error('[jobs] ai_feed failed', err);
    }
  });

  // 启动后短暂延迟跑一次维护，保证状态及时
  setTimeout(() => {
    runMaintenance()
      .then((r) => console.log('[jobs] boot maintenance', r.summary))
      .catch((err) => console.error('[jobs] boot maintenance failed', err));
  }, 1500);

  console.log('[jobs] scheduler started');
}
