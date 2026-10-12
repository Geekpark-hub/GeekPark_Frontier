import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import router from './router';
import './styles.css';

const app = createApp(App);

app.config.errorHandler = (err, _instance, info) => {
  console.error('[vue]', err, info);
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/500')) {
    router.replace('/500');
  }
};

app.use(router).use(ElementPlus).mount('#app');
