import { defineConfig } from '@playwright/test';

// Layout regression tests: real Chromium layout, measured by element coordinates.
// Runs the NAVI front end in /demo mode (local mock, no backend) on its own port, so a dev server
// already using 5173 is never touched.
const PORT = 4180;

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium', hasTouch: true, isMobile: true },
  webServer: {
    command: `npm run dev --workspace @navi/web -- --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/demo`,
    reuseExistingServer: false,
    timeout: 60_000,
    // Any origin works: window.open is stubbed in the tests; it only enables the 帶我去 buttons.
    env: { VITE_MOCK_SITE_URL: 'http://127.0.0.1:4181' },
  },
});
