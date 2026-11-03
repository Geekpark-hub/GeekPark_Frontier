import cron from 'node-cron';
import { runMaintenance } from './maintenance.js';
import { runAiFeed } from './aiFeed.js';
import { ingestRssArchive } from '../services/rss.js';

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

  // 每 4 小时：沉淀 RSS，逐步攒满约一个月窗口
  cron.schedule(process.env.CRON_RSS_INGEST || '20 */4 * * *', async () => {
    try {
      const result = await ingestRssArchive();
      console.log('[jobs] rss_ingest', result.summary);
    } catch (err) {
      console.error('[jobs] rss_ingest failed', err);
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

  // 启动后短暂延迟跑一次维护 + RSS 归档
  setTimeout(() => {
    runMaintenance()
      .then((r) => console.log('[jobs] boot maintenance', r.summary))
      .catch((err) => console.error('[jobs] boot maintenance failed', err));
    ingestRssArchive()
      .then((r) => console.log('[jobs] boot rss_ingest', r.summary))
      .catch((err) => console.error('[jobs] boot rss_ingest failed', err));
  }, 1500);

  console.log('[jobs] scheduler started');
}
