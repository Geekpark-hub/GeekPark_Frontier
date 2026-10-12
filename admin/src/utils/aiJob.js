import { ElMessage } from 'element-plus';
import api from '../api';
import { refreshAiJobStatus } from '../stores/aiJobMonitor';

/**
 * 只负责启动后台任务；进度与完成通知由 Layout 全局监听。
 */
export async function startAiFeedJob({ limitPerMember = 2 } = {}) {
  const start = await api.post('/admin/ai/run-feed', { limitPerMember, async: true });
  await refreshAiJobStatus();

  if (!start.started && start.reason === 'already_running') {
    ElMessage.warning('已有抓取任务在进行中，可继续浏览其他页面');
  } else {
    ElMessage.success('已开始后台抓取，完成后会自动通知你');
  }
  return start;
}
