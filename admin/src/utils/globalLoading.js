import { ElLoading } from 'element-plus';
import 'element-plus/es/components/loading/style/css';

let pending = 0;
let timer = null;
let service = null;

/** 仅慢请求才出遮罩，避免切页闪一下 */
const DELAY_MS = 700;

function show() {
  if (service) return;
  service = ElLoading.service({
    lock: true,
    text: '加载中…',
    background: 'rgba(20, 32, 43, 0.12)',
  });
}

function hide() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (service) {
    service.close();
    service = null;
  }
}

export function trackGlobalLoading(delta) {
  pending = Math.max(0, pending + delta);
  if (pending > 0) {
    if (!timer && !service) {
      timer = setTimeout(() => {
        timer = null;
        if (pending > 0) show();
      }, DELAY_MS);
    }
  } else {
    hide();
  }
}

export function shouldSkipGlobalLoading(config) {
  if (!config) return true;
  if (config.skipGlobalLoading) return true;
  if (config.silentAuth) return true;
  // 列表/查询类 GET 不挡全屏，交给页面自身空态
  const method = String(config.method || 'get').toLowerCase();
  if (method === 'get' || method === 'head') return true;
  // 上传走本地按钮 loading，避免双层遮罩
  if (String(config.url || '').includes('/upload/')) return true;
  // AI 状态轮询不打扰
  if (String(config.url || '').includes('/ai/status')) return true;
  return false;
}
