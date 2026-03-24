const BASE_URL = process.env.LOAD_BASE_URL || 'http://localhost:3000';
const TOTAL_REQUESTS = Number.parseInt(process.env.LOAD_REQUESTS || '300', 10);
const CONCURRENCY = Number.parseInt(process.env.LOAD_CONCURRENCY || '20', 10);
const TIMEOUT_MS = Number.parseInt(process.env.LOAD_TIMEOUT_MS || '15000', 10);

const ENDPOINTS = [
  '/api/status',
  '/api/beers?limit=20&offset=0',
  '/api/reviews?limit=20&offset=0',
  '/api/users?limit=20',
  '/api/notifications?limit=10&offset=0',
];

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log('Starting load test...');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Requests: ${TOTAL_REQUESTS} | Concurrency: ${CONCURRENCY} | Timeout: ${TIMEOUT_MS}ms`);

  const latencies = [];
  const errors = [];
  const byStatus = new Map();
  const byEndpoint = new Map(ENDPOINTS.map((ep) => [ep, { ok: 0, failed: 0, count: 0, latency: [] }]));

  const startedAt = Date.now();
  let sent = 0;

  async function worker() {
    while (true) {
      const requestId = sent;
      sent += 1;
      if (requestId >= TOTAL_REQUESTS) {
        return;
      }

      const endpoint = ENDPOINTS[requestId % ENDPOINTS.length];
      const url = `${BASE_URL}${endpoint}`;
      const t0 = Date.now();

      try {
        const response = await fetchWithTimeout(url, TIMEOUT_MS);
        const duration = Date.now() - t0;
        latencies.push(duration);

        const statusKey = String(response.status);
        byStatus.set(statusKey, (byStatus.get(statusKey) || 0) + 1);

        const epStats = byEndpoint.get(endpoint);
        epStats.count += 1;
        epStats.latency.push(duration);
        if (response.ok) {
          epStats.ok += 1;
        } else {
          epStats.failed += 1;
        }

        // Consume body to avoid socket backpressure in long runs.
        await response.text();
      } catch (error) {
        const duration = Date.now() - t0;
        latencies.push(duration);
        errors.push({ endpoint, message: error && error.message ? error.message : String(error) });

        const epStats = byEndpoint.get(endpoint);
        epStats.count += 1;
        epStats.failed += 1;
        epStats.latency.push(duration);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker());
  await Promise.all(workers);

  // Let pending sockets settle before final metrics.
  await wait(100);

  const finishedAt = Date.now();
  const elapsedSec = Math.max(1, (finishedAt - startedAt) / 1000);
  const okCount = Array.from(byEndpoint.values()).reduce((acc, s) => acc + s.ok, 0);
  const failCount = Array.from(byEndpoint.values()).reduce((acc, s) => acc + s.failed, 0);

  const report = {
    baseUrl: BASE_URL,
    totalRequests: TOTAL_REQUESTS,
    concurrency: CONCURRENCY,
    elapsedSeconds: Number(elapsedSec.toFixed(2)),
    throughputRps: Number((TOTAL_REQUESTS / elapsedSec).toFixed(2)),
    successRate: Number(((okCount / Math.max(1, TOTAL_REQUESTS)) * 100).toFixed(2)),
    failures: failCount,
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : 0,
      avg: latencies.length ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)) : 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length ? Math.max(...latencies) : 0,
    },
    byStatus: Object.fromEntries(byStatus.entries()),
    byEndpoint: Object.fromEntries(Array.from(byEndpoint.entries()).map(([endpoint, stats]) => [
      endpoint,
      {
        count: stats.count,
        ok: stats.ok,
        failed: stats.failed,
        avgLatencyMs: stats.latency.length
          ? Number((stats.latency.reduce((a, b) => a + b, 0) / stats.latency.length).toFixed(2))
          : 0,
        p95LatencyMs: percentile(stats.latency, 95),
      },
    ])),
    sampleErrors: errors.slice(0, 10),
  };

  console.log('Load test finished.');
  console.log(JSON.stringify(report, null, 2));

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Load test crashed:', error);
  process.exit(1);
});