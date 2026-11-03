import { createApp } from 'vue';
import { ElMessage } from 'element-plus';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App.vue';
import router from './router';
import './styles.css';
// 按需组件不会自动带上 JS API（Message / MessageBox / Notification）样式
import 'element-plus/es/components/message/style/css';
import 'element-plus/es/components/message-box/style/css';
import 'element-plus/es/components/notification/style/css';
import 'element-plus/es/components/overlay/style/css';

dayjs.locale('zh-cn');

const app = createApp(App);

app.config.errorHandler = (err, _instance, info) => {
  console.error('[vue]', err, info);
  // 取消确认框等可预期中断，不要整页跳 500
  const msg = String(err?.message || err || '');
  if (/cancel|close|abort/i.test(msg)) return;
  try {
    ElMessage.error('操作失败，请稍后重试');
  } catch {
    /* ignore */
  }
};

app.use(router).mount('#app');
