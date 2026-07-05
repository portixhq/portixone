// Uses the monorepo's local sdk-js build (relative import) rather than the
// published npm package, since it wants getMetrics() — newer than the last
// publish. Not a workspace/package.json dependency: Node resolves relative
// paths directly, no install step needed.
import { Portix } from '../../sdk-js/dist/index.js';

const COUNT = Number(process.argv[2] ?? process.env.STRESS_COUNT ?? 100);
const CONCURRENCY = Number(process.env.STRESS_CONCURRENCY ?? 20);
const HOST = process.env.PORTIX_HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORTIX_PORT ?? 17321);
const API_KEY = process.env.PORTIX_API_KEY ?? 'dev-local-key';

const portix = new Portix({ host: HOST, port: PORT, apiKey: API_KEY });
await portix.connect();

console.log(`Firing ${COUNT} print() calls at ${HOST}:${PORT}, ${CONCURRENCY} at a time...`);
console.log('(Uses whichever printer driver the runtime is configured with — point this at a mock-driver runtime unless you actually want that many sheets of paper.)\n');

async function fireOne(index) {
  const start = Date.now();
  try {
    await portix.print({ content: `Stress test job #${index + 1}` });
    return { ok: true, enqueueMs: Date.now() - start };
  } catch (error) {
    return { ok: false, enqueueMs: Date.now() - start, error: error.message };
  }
}

const results = [];
const overallStart = Date.now();

for (let i = 0; i < COUNT; i += CONCURRENCY) {
  const batchSize = Math.min(CONCURRENCY, COUNT - i);
  const batch = await Promise.all(Array.from({ length: batchSize }, (_, j) => fireOne(i + j)));
  results.push(...batch);
  process.stdout.write(`\rEnqueued ${Math.min(i + CONCURRENCY, COUNT)}/${COUNT}`);
}
process.stdout.write('\n');

const totalMs = Date.now() - overallStart;
const succeeded = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);
const enqueueLatencies = results.map((r) => r.enqueueMs).sort((a, b) => a - b);
const avgEnqueueMs = enqueueLatencies.reduce((sum, v) => sum + v, 0) / enqueueLatencies.length;
const p95EnqueueMs = enqueueLatencies[Math.floor(enqueueLatencies.length * 0.95)];

console.log('\n--- Client side: enqueue throughput (HTTP round trip to "202 Accepted", not full print completion) ---');
console.log(`Jobs: ${COUNT} (${succeeded.length} accepted, ${failed.length} rejected)`);
console.log(`Total wall time: ${totalMs}ms → ${(COUNT / (totalMs / 1000)).toFixed(1)} jobs/sec enqueue rate`);
console.log(
  `Enqueue latency — avg ${avgEnqueueMs.toFixed(1)}ms, p95 ${p95EnqueueMs}ms, min ${enqueueLatencies[0]}ms, max ${enqueueLatencies.at(-1)}ms`,
);
if (failed.length > 0) {
  console.log(`First rejection: ${failed[0].error}`);
}

try {
  const metrics = await portix.getMetrics();
  console.log('\n--- Runtime side: GET /metrics (the real print()-to-paper numbers) ---');
  console.log(JSON.stringify(metrics, null, 2));
} catch (error) {
  console.log(`\n(Could not fetch /metrics — needs the runtime's admin key: ${error.message})`);
}

await portix.disconnect();
process.exit(failed.length > 0 ? 1 : 0);
