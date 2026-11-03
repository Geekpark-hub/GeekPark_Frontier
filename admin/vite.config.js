import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 生产可把静态资源挂到七牛，例如 https://frontier.geekpark.net/frontier/admin/
  const cdnBase = String(env.ADMIN_CDN_BASE || '').trim();

  return {
    base: cdnBase || '/',
    appType: 'spa',
    plugins: [
      vue(),
      // 本地开发：浏览器误开 /api/* 时跳登录页，避免看到 JSON
      {
        name: 'frontier-api-html-to-login',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url || '';
            const accept = String(req.headers.accept || '');
            if (
              url.startsWith('/api') &&
              !url.startsWith('/api/health') &&
              accept.includes('text/html') &&
              !accept.includes('application/json')
            ) {
              res.statusCode = 302;
              res.setHeader('Location', '/login');
              res.end();
              return;
            }
            next();
          });
        },
      },
      AutoImport({
        resolvers: [ElementPlusResolver()],
      }),
      Components({
        resolvers: [ElementPlusResolver()],
      }),
    ],
    build: {
      target: 'es2019',
      cssCodeSplit: true,
      sourcemap: false,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            // 不要把 element-plus 打成整包，否则按需引入失效
            if (id.includes('element-plus') || id.includes('@element-plus')) return;
            if (id.includes('vue-router') || id.includes('/vue/') || id.includes('\\vue\\')) {
              return 'vue-vendor';
            }
            if (id.includes('axios')) return 'axios';
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: {
        // 只代理 /api，页面路由 /feed /events 等交给 Vue
        '/api': proxyApi(),
        '/uploads': proxyApi(),
        '/health': proxyApi(),
      },
    },
  };
});
