import type { JobStatus } from './job.types.js';

/**
 * Milestone 4's measurement layer — "medir, no desarrollar". Answers the
 * questions that actually matter for production validation: how long does
 * pairing take, how long from print() to paper, how often does it fail.
 */
export interface RuntimeMetrics {
  uptimeMs: number;
  jobs: {
    total: number;
    byStatus: Record<JobStatus, number>;
    /** Average time from a job being queued to reaching `completed`, in ms — over completed jobs only. */
    avgDurationMs?: number;
    /** Same measurement for the single most recently completed job. */
    lastDurationMs?: number;
  };
  pairing: {
    totalApproved: number;
    /** Average time from `pair()` being requested to a human approving it, in ms. */
    avgPairingDurationMs?: number;
  };
  websocket: {
    activeConnections: number;
    /**
     * How many client sockets have disconnected since the runtime started —
     * a proxy for "reconexiones" until the SDK's WebSocket client actually
     * implements reconnect-on-drop (it doesn't yet, see MILESTONE_3.md
     * Phase 3). Every disconnect counted here today is one the SDK never
     * recovered from automatically.
     */
    totalDisconnects: number;
  };
}
