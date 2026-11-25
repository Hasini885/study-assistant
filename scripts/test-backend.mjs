// Runs the backend tests with explicit file paths. `node --test` only expands
// glob patterns from Node 21, and engines allows Node 20.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'backend/tests';
const files = readdirSync(dir, { recursive: true })
  .filter((f) => String(f).endsWith('.test.js'))
  .map((f) => join(dir, String(f)))
  .sort();

const { status } = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(status ?? 1);
