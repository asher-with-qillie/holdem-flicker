import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site under /holdem-flicker/.
// Set VITE_BASE=/ for local previews at the root if needed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/holdem-flicker/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // 해설 감사는 전 차트 × 169 핸드를 훑습니다 — 기본 5초로는 모자랍니다.
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
