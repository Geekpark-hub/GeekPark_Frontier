import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

function proxyApi() {
  return {
    target: 'http://127.0.0.1:3000',
    changeOrigin: true,
    configure(proxy) {
      proxy.on('error', (_err, _req, res) => {
        if (res && !res.headersSent && typeof res.writeHead === 'function') {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '服务暂时不可用，请稍后重试' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/auth': proxyApi(),
      '/admin': proxyApi(),
      '/feed': proxyApi(),
      '/polls': proxyApi(),
      '/events': proxyApi(),
      '/requests': proxyApi(),
      '/health': proxyApi(),
      '/uploads': proxyApi(),
    },
  },
});
