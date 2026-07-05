import type { JobStatus, RuntimeMetrics } from '@portixone/protocol';
import type { QueueStore } from '../queue/queue.store.js';
import type { PairingStore } from '../pairing/pairing.store.js';
import type { WebSocketManager } from '../api/websocket.manager.js';

const STATUSES: JobStatus[] = ['pending', 'printing', 'completed', 'failed', 'cancelled'];

function average(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/**
 * Milestone 4's measurement layer — aggregates from data already persisted
 * elsewhere (QueueStore's job history, PairingStore's approved pairings, the
 * WebSocket manager's connection stats). No new instrumentation needed for
 * most of this; the timestamps were already there.
 */
export class MetricsService {
  private readonly startedAt = Date.now();
  private wsManager?: WebSocketManager;

  constructor(
    private readonly queueStore: QueueStore,
    private readonly pairingStore: PairingStore,
  ) {}

  /** Wired in after construction — the WebSocketManager needs the HTTP server, which needs this service's routes first. Same pattern as QueueService. */
  attachWebSocketManager(wsManager: WebSocketManager): void {
    this.wsManager = wsManager;
  }

  collect(): RuntimeMetrics {
    const jobs = this.queueStore.list().map((entry) => entry.record);
    const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<JobStatus, number>;
    for (const job of jobs) {
      byStatus[job.status] += 1;
    }

    const completedJobs = jobs
      .filter((job) => job.status === 'completed')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const completedDurations = completedJobs.map(
      (job) => new Date(job.updatedAt).getTime() - new Date(job.createdAt).getTime(),
    );

    const pairings = this.pairingStore.list();
    const pairingDurations = pairings.map((record) => record.pairingDurationMs);

    return {
      uptimeMs: Date.now() - this.startedAt,
      jobs: {
        total: jobs.length,
        byStatus,
        avgDurationMs: average(completedDurations),
        lastDurationMs: completedDurations[0],
      },
      pairing: {
        totalApproved: pairings.length,
        avgPairingDurationMs: average(pairingDurations),
      },
      websocket: this.wsManager?.getStats() ?? { activeConnections: 0, totalDisconnects: 0 },
    };
  }
}
