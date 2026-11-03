import 'dotenv/config';
import './polyfill-fetch.js';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import feedRoutes from './routes/feed.js';
import pollRoutes from './routes/polls.js';
import eventRoutes from './routes/events.js';
import requestRoutes from './routes/requests.js';
import analyticsRoutes from './routes/analytics.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes, { uploadDir } from './routes/upload.js';
import { startScheduler } from './jobs/scheduler.js';
import { getSearchStatus } from './services/search.js';
import { getLlmStatus } from './services/llm.js';
import { getNotifyStatus } from './services/notify.js';
import { getFeishuStatus } from './services/feishu.js';
import { getQiniuStatus } from './services/qiniu.js';
import feishuActionRoutes from './routes/feishuActions.js';
import shareRedirectRoutes from './routes/shareRedirect.js';
import notifyRoutes from './routes/notify.js';
import briefRoutes from './routes/briefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

// 本地上传兼容（历史相对路径）；新封面走七牛
app.use('/uploads', express.static(uploadDir || path.resolve(__dirname, '../uploads')));

function healthPayload() {
  return {
    ok: true,
    service: 'frontier-society-api',
    search: getSearchStatus(),
    llm: getLlmStatus(),
    notify: getNotifyStatus(),
    feishu: getFeishuStatus(),
    qiniu: getQiniuStatus(),
  };
}

app.get('/health', (_req, res) => {
  res.json(healthPayload());
});

// 全部业务 API 统一挂在 /api，避免与管理后台页面路由（/feed /events 等）冲突
const api = express.Router();
// 仅「浏览器地址栏打开」才跳登录；axios/小程序带 application/json 或 */* 不受影响
api.use((req, res, next) => {
  const accept = String(req.headers.accept || '');
  // 飞书批准/拒绝链接需在浏览器直接打开 HTML 结果页
  if (req.path.startsWith('/feishu/')) return next();
  const isDocumentNav =
    (req.method === 'GET' || req.method === 'HEAD') &&
    req.path !== '/health' &&
    accept.includes('text/html') &&
    !accept.includes('application/json');
  if (isDocumentNav) {
    return res.redirect(302, '/login');
  }
  next();
});
api.get('/health', (_req, res) => {
  res.json(healthPayload());
});
api.use('/feishu', feishuActionRoutes);
api.use('/auth', authRoutes);
api.use('/feed', feedRoutes);
api.use('/polls', pollRoutes);
api.use('/events', eventRoutes);
api.use('/requests', requestRoutes);
api.use('/analytics', analyticsRoutes);
api.use('/notify', notifyRoutes);
api.use('/briefs', briefRoutes);
api.use('/admin', adminRoutes);
api.use('/admin/upload', uploadRoutes);
app.use('/api', api);

// 固定分享短链：/s/e/:id 活动、/s/p/:id 投票、/s/b/:id 内参 → 302 到微信 URL Link
app.use('/s', shareRedirectRoutes);

// 生产环境托管管理后台；页面路由与 /api 完全分离
const adminDist = process.env.ADMIN_DIST
  ? path.resolve(process.env.ADMIN_DIST)
  : path.resolve(__dirname, '../../admin/dist');
if (fs.existsSync(adminDist)) {
  app.use(express.static(adminDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api(?:\/|$)|\/uploads(?:\/|$)|\/health(?:\/|$)|\/s(?:\/|$)).*/, (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // 浏览器地址栏打开时一定回 SPA，不再把 JSON 错误甩到页面上
    if (req.accepts('html')) {
      return res.sendFile(path.join(adminDist, 'index.html'), (err) => {
        if (err) next();
      });
    }
    return next();
  });
}

app.use((req, res) => {
  if (req.accepts('html') && fs.existsSync(adminDist)) {
    return res.status(404).sendFile(path.join(adminDist, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: '接口不存在' });
    });
  }
  res.status(404).json({ error: '接口不存在' });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = Number(err.status || err.statusCode) || 500;
  const message =
    status >= 500
      ? '服务暂时出了点问题，请稍后重试'
      : (err.message || '请求失败');
  res.status(status).json({ error: message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontier Society API listening on http://0.0.0.0:${PORT}`);
  console.log(`API base: http://0.0.0.0:${PORT}/api`);
  console.log('[ai]', getSearchStatus(), getLlmStatus());
  if (process.env.ENABLE_JOBS !== 'false') {
    startScheduler();
  }
});
