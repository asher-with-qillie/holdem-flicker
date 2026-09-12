import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site under /holdem-flicker/.
// Set VITE_BASE=/ for local previews at the root if needed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/holdem-flicker/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
