import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use('/uploads', express.static(uploadDir || path.resolve(__dirname, '../uploads')));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'frontier-society-api',
    search: getSearchStatus(),
    llm: getLlmStatus(),
    notify: getNotifyStatus(),
    feishu: getFeishuStatus(),
  });
});

app.use('/auth', authRoutes);
app.use('/feed', feedRoutes);
app.use('/polls', pollRoutes);
app.use('/events', eventRoutes);
app.use('/requests', requestRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/admin', adminRoutes);
app.use('/admin/upload', uploadRoutes);

app.use((req, res) => {
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
  console.log(`LAN tip: use http://<your-ip>:${PORT} for real-device debug`);
  console.log('[ai]', getSearchStatus(), getLlmStatus());
  startScheduler();
});
