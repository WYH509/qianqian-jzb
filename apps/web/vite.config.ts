import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3456',
        // 关掉 changeOrigin：让 Host 保留 :4173 → 后端 res.cookie() 设 cookie 到 :4173
        // （浏览器 跟 :4173，能存能取）。changeOrigin: true 会把 Host 改成 :3456，
        // 导致 cookie 设到 :3456 → 浏览器不存 :4173 → CSRF 永远读不到。
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
