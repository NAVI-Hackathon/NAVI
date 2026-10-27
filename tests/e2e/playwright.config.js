import { defineConfig } from '@playwright/test';

// End-to-end: the mock insurer site with NAVI embedded, in demo mode inside the site (?navi=demo): local
// official-data snapshot and rules, no backend and no Gemini calls.
//   npm run test:e2e                                        # local: both apps on their own ports (never 3000 / 5173)
//   E2E_BASE_URL=https://navitw.com npm run test:e2e        # a deployed release (production regression)
const NAVI = 4190, SITE = 4191;
const deployed = process.env.E2E_BASE_URL?.replace(/\/$/, '');

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: deployed ?? `http://127.0.0.1:${SITE}`, browserName: 'chromium' },
  webServer: deployed ? undefined : [
    {
      command: `npm run dev --workspace @navi/web -- --port ${NAVI} --strictPort`,
      url: `http://127.0.0.1:${NAVI}/embed?mode=demo`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: { VITE_EMBED_ALLOWED_ORIGINS: `http://127.0.0.1:${SITE}`, VITE_MOCK_SITE_URL: `http://127.0.0.1:${SITE}` },
    },
    {
      command: `npm exec --workspace @navi/mock-site -- next dev --hostname 127.0.0.1 --port ${SITE}`,
      url: `http://127.0.0.1:${SITE}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_PUBLIC_NAVI_EMBED_URL: `http://127.0.0.1:${NAVI}/embed` },
    },
  ],
});
