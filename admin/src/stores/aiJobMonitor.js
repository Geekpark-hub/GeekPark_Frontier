import { computed, ref } from 'vue';
import { ElNotification } from 'element-plus';
import api, { goLoginPage, isOnLoginPage } from '../api';

const currentRun = ref(null);
const pendingAuto = ref(0);
const monitoring = ref(false);

let timer = null;
let lastStatus = null;
let notifiedRunId = null;

export function useAiJobMonitorState() {
  return {
    currentRun,
    pendingAuto,
    monitoring,
    isRunning: computed(() => currentRun.value?.status === 'running'),
  };
}

export function startAiJobMonitor() {
  if (timer) return;
  tick();
  timer = setInterval(tick, 3000);
}

export function stopAiJobMonitor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick() {
  if (!localStorage.getItem('admin_token')) return;
  try {
    const res = await api.get('/admin/ai/status', { silentAuth: true });
    currentRun.value = res.currentRun || null;
    pendingAuto.value = res.pendingAuto || 0;
    monitoring.value = res.currentRun?.status === 'running';

    const run = res.currentRun;
    if (run && run.status !== 'running' && run.id && run.id !== notifiedRunId && lastStatus === 'running') {
      notifiedRunId = run.id;
      const ok = run.status === 'ok';
      ElNotification({
        title: ok ? 'AI 抓取完成' : 'AI 抓取失败',
        message: run.summary || (ok ? '请到动态管理查看待审核' : '请到 AI 与任务查看日志'),
        type: ok ? 'success' : 'error',
        duration: 8000,
        onClick: () => {
          window.dispatchEvent(new CustomEvent('ai-feed-navigate'));
        },
      });
      window.dispatchEvent(
        new CustomEvent('ai-feed-done', {
          detail: { run, pendingAuto: res.pendingAuto, status: res },
        })
      );
    }

    lastStatus = run?.status || null;
    if (run?.status === 'running') {
      // 标记本轮结束后需要通知
      notifiedRunId = null;
    }
  } catch (err) {
    // Token 失效时停止轮询，避免每 3 秒刷一次错误
    if (!localStorage.getItem('admin_token')) {
      stopAiJobMonitor();
      if (!isOnLoginPage()) goLoginPage();
    }
  }
}

/** 刚点了开始抓取时立刻拉一次，避免等 3 秒 */
export async function refreshAiJobStatus() {
  await tick();
}
