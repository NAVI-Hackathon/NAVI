import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { planNavigation } from '../../../../shared/knowledge/navigationPlan.js';
import { getKnowledgeVersion } from './knowledgeVersionService.js';
import { ApiError } from '../middleware/errorHandler.js';

const ManifestSchema = z.object({
  schemaVersion: z.literal(1), knowledgeVersion: z.string(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.literal('built_mock_site_only'), issues: z.array(z.unknown()).length(0),
  targets: z.array(z.object({ sourceId: z.string(), path: z.string(), anchor: z.string().nullable() }).strict()),
});
export function createNavigationService({ production = false, navigationManifest }, readManifest = () => JSON.parse(readFileSync(new URL('../../../../data/navigation-targets.json', import.meta.url), 'utf8'))) {
  let manifest;
  return input => {
    const response = planNavigation(input);
    if (!response.plan || !production) return response;
    try {
      manifest ??= ManifestSchema.parse(navigationManifest ?? readManifest());
      const version = getKnowledgeVersion();
      if (manifest.knowledgeVersion !== version.knowledgeVersion || manifest.snapshotHash !== version.snapshotHash) throw Error('Stale build');
      for (const { sourceId, destination } of response.plan.steps) if (!manifest.targets.some(t => t.sourceId === sourceId && t.path === destination.path && t.anchor === destination.anchor)) throw Error('Missing target');
    } catch {
      throw new ApiError('NAVIGATION_TARGET_UNAVAILABLE', '這段導覽的頁面位置尚未通過驗證，請先查看資料來源或稍後再試。', 503, false);
    }
    return response;
  };
}
