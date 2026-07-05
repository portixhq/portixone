import type { ServerResponse } from 'node:http';
import type { MetricsService } from '../metrics/metrics.service.js';

export function handleGetMetrics(res: ServerResponse, metricsService: MetricsService): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(metricsService.collect()));
}
