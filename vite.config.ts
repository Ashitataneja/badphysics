/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: 'localhost', port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
