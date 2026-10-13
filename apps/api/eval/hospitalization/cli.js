import { loadHospitalDataset, evaluateHospitalization } from './runner.js';
const result = await evaluateHospitalization(await loadHospitalDataset());
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.failed ? 1 : 0;
