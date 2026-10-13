import { evaluateKnowledge, loadKnowledgeDataset } from './runner.js';
const report = evaluateKnowledge(await loadKnowledgeDataset());
console.info(JSON.stringify(report, null, 2));
if (report.failed || report.metrics.invalidSourceRate.invalid || report.metrics.invalidRouteRate.invalid) process.exitCode = 1;
