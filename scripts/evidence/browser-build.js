import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Prove the new shared entry points bundle for a browser without touching A's application.
const result = await build({
  configFile: false, logLevel: 'warn',
  build: { write: false, lib: { entry: fileURLToPath(new URL('../../shared/knowledge/navigationPlan.js', import.meta.url)), formats: ['es'] } },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
for (const item of outputs) if (item.type === 'chunk') {
  assert.ok(!/__vite-browser-external|from\s*["']node:/.test(item.code), 'Browser bundle must not require Node builtins');
}
console.log(JSON.stringify({ browserBundle: true, chunks: outputs.length, bytes: outputs.reduce((sum, item) => sum + (item.type === 'chunk' ? Buffer.byteLength(item.code) : item.source.length), 0) }));
