import { loadConfig } from './config/env.js';
import { createApp } from './app.js';

if (process.argv.includes('--demo')) process.env.AI_MODE = 'demo';
if (process.argv.includes('--live')) process.env.AI_MODE = 'live';
const config = loadConfig();
if (config.aiMode === 'live') console.info(`LIVE GEMINI REQUEST\nRequests planned: 0 at startup; manual API actions only\nMax allowed (including retries): ${config.dailyLimit} per Pacific day; ${config.publicSynthetic ? 'anonymous synthetic sessions; approved document fingerprints only' : 'synthetic operator session required when restricted'}`);
const server = createApp(config).listen(config.port, config.host, () => console.info(`NAVI API listening on http://${config.host}:${config.port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref(); });
