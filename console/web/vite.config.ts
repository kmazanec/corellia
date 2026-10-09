import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env['CONSOLE_API'] ?? 'http://localhost:8090';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': { target: api, changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: true },
});
