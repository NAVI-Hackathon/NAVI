import { z } from 'zod';
import * as schemas from '../shared/product.js';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../docs/a3-product-schemas.json', import.meta.url));
const output = JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'NAVI A3 request and response schemas', description: 'Generated from shared/product.js. Endpoint authorization, status and custom refinements remain defined by a3-persistence-contract.md and runtime Zod validation; not a deployed capability declaration.', $defs: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema)])) }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== output) throw new Error('A3 schemas changed; regenerate the contract');
} else await writeFile(path, output);
