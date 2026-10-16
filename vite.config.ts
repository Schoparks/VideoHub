import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()], base: './',
  server: { port: 5173, strictPort: true, host: '127.0.0.1', watch: { ignored: ['**/.tmp/**', '**/.data/**', '**/.pnpm-store/**', '**/release/**', '**/dist-electron/**'] } },
  build: { sourcemap: true }
});
