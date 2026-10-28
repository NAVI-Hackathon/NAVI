import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',timeout:90000,workers:1,reporter:'list',use:{baseURL:'http://127.0.0.1:4184',browserName:'chromium'},webServer:{command:'npm run dev --workspace @navi/web -- --port 4184 --strictPort',url:'http://127.0.0.1:4184',reuseExistingServer:false,env:{VITE_MOCK_SITE_URL:'http://127.0.0.1:4185'}}});
