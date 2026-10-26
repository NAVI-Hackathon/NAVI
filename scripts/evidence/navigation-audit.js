import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNavigationPlan, verifyNavigationPlan } from '../../shared/knowledge/navigationPlan.js';
import { knowledgeEntries, verifyKnowledgeSource, knowledgeSource, verifyEvidenceSnippet } from '../../shared/knowledge/index.js';
import { getKnowledgeVersion } from '../../apps/api/src/services/knowledgeVersionService.js';

export async function auditNavigation(siteDirectory) {
  const pages = new Map(); const targets = []; const issues = [];
  let plans = 0; let steps = 0;
  for (const entry of knowledgeEntries) {
    const source = knowledgeSource(entry);
    if (!verifyKnowledgeSource(source)) issues.push({ type: 'SOURCE_ID_MISMATCH', sourceId: entry.id });
    const plan = buildNavigationPlan(entry.id);
    if (!plan || !verifyNavigationPlan(plan)) { issues.push({ type: 'INVALID_URL_OR_SOURCE', sourceId: entry.id }); continue; }
    plans++;
    for (const step of plan.steps) {
      steps++;
      const { path, anchor } = step.destination;
      if (!pages.has(path)) {
        const relative = path === '/' ? 'index' : path.slice(1);
        const candidates = [join(siteDirectory, `${relative}.html`), join(siteDirectory, relative, 'index.html')];
        let html = null;
        for (const filename of candidates) { try { html = await readFile(filename, 'utf8'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; } }
        pages.set(path, html);
      }
      const html = pages.get(path);
      const valid = html && (anchor === null || html.includes(`data-tour-id="${anchor}"`) || html.includes(`id="${anchor}"`));
      if (!valid) issues.push({ type: 'MISSING_TARGET', sourceId: step.sourceId, path, anchor });
      if (step.evidence.some(text => !verifyEvidenceSnippet(step.sourceId, text))) issues.push({ type: 'INVALID_EXCERPT', sourceId: step.sourceId });
      const target = { sourceId: step.sourceId, path, anchor };
      if (valid && !targets.some(t => JSON.stringify(t) === JSON.stringify(target))) targets.push(target);
    }
  }
  const version = getKnowledgeVersion();
  return { schemaVersion: 1, knowledgeVersion: version.knowledgeVersion, snapshotHash: version.snapshotHash,
    scope: 'built_mock_site_only', generatedAt: new Date().toISOString(), plans, steps, pages: pages.size, targets, issues,
    deprecatedTargets: null, previousManifestAvailable: false, liveOfficialWebsiteIntegration: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditNavigation(resolve(process.argv[2] ?? 'apps/mock-site/.next/server/app'));
  if (process.argv[3]) await writeFile(resolve(process.argv[3]), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (report.issues.length) process.exitCode = 1;
}
