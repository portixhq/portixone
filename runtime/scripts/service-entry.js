import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Windows Services don't reliably inherit the working directory the script
// lives in, but config.service.ts resolves `.data/config.json` (and `--env-file`
// would resolve `.env`) relative to process.cwd() — so force it here before
// anything else runs.
const runtimeRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(runtimeRoot);

try {
  process.loadEnvFile(join(runtimeRoot, '.env'));
} catch {
  // no .env — same behavior as --env-file-if-exists in package.json's scripts
}

await import('../dist/index.js');
