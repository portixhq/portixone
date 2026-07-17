import { randomUUID } from 'node:crypto';
import {
  WS_EVENTS,
  type JobOwner,
  type JobRecord,
  type JobStatus,
  type PrintJobInput,
  type PrintJobResult,
} from '@portixone/protocol';
import { JobNotCancellableError, JobNotFoundError } from '@portixone/shared';
import type { LoggerService } from '../logger/logger.service.js';
import type { WebSocketManager } from '../api/websocket.manager.js';
import { QueueStore, type StoredJob } from './queue.store.js';
import { QueueWorker } from './queue.worker.js';

const EVENT_BY_STATUS: Record<JobStatus, string> = {
  pending: WS_EVENTS.JOB_QUEUED,
  printing: WS_EVENTS.JOB_PRINTING,
  completed: WS_EVENTS.JOB_PRINTED,
  failed: WS_EVENTS.JOB_ERROR,
  cancelled: WS_EVENTS.JOB_CANCELLED,
};

const RESTART_FAILURE_MESSAGE = 'Runtime restarted while printing.';

/**
 * Owns queue sequencing, ownership scoping, and history — QueueStore only
 * persists, QueueWorker only executes a single print. Every enqueue/cancel/
 * transition writes through to disk immediately via the store; nothing waits
 * for shutdown.
 */
export class QueueService {
  private readonly pendingIds: string[] = [];
  private wsManager?: WebSocketManager;

  constructor(
    private readonly store: QueueStore,
    private readonly worker: QueueWorker,
    private readonly logger: LoggerService,
  ) {}

  attachWebSocketManager(wsManager: WebSocketManager): void {
    this.wsManager = wsManager;
  }

  /**
   * Runs once at startup, after reading queue.json: a job frozen in
   * `printing` when the runtime last stopped can't be trusted to have
   * actually reached the printer, so it's marked `failed` rather than
   * silently resumed or lost. A `pending` job never started, so it's safe to
   * resume as-is — its original print payload was persisted alongside it.
   */
  recover(): void {
    for (const entry of this.store.list()) {
      if (entry.record.status === 'printing') {
        this.transition(entry, 'failed', RESTART_FAILURE_MESSAGE);
        this.logger.warn('Job marked failed after restart — was mid-print when the runtime stopped', {
          jobId: entry.record.jobId,
        });
      } else if (entry.record.status === 'pending') {
        this.pendingIds.push(entry.record.jobId);
      }
    }

    if (this.pendingIds.length > 0) {
      this.logger.info(`Resuming ${this.pendingIds.length} pending job(s) queued before the runtime last stopped`);
      void this.processNext();
    }
  }

  enqueue(job: PrintJobInput, owner?: JobOwner): PrintJobResult {
    const jobId = randomUUID();
    const now = new Date().toISOString();
    const entry: StoredJob = {
      job,
      record: {
        jobId,
        status: 'pending',
        // Record BOTH: the target the caller asked for and the printer it resolved to on this
        // machine. Keeping only the printer would lose the reason a job went where it went, which
        // is the first question anyone asks when a ticket comes out of the wrong device.
        target: job.target,
        printerName: job.printerName,
        copies: job.copies,
        createdAt: now,
        updatedAt: now,
        owner,
      },
    };
    this.store.upsert(entry);
    this.pendingIds.push(jobId);
    this.broadcast(entry.record);
    void this.processNext();
    return { jobId, status: 'pending' };
  }

  cancel(jobId: string, owner?: JobOwner): PrintJobResult {
    const entry = this.requireOwned(jobId, owner);
    if (entry.record.status !== 'pending') {
      throw new JobNotCancellableError(entry.record.status);
    }

    const index = this.pendingIds.indexOf(jobId);
    if (index >= 0) {
      this.pendingIds.splice(index, 1);
    }
    return this.transition(entry, 'cancelled');
  }

  getJobs(owner?: JobOwner): JobRecord[] {
    return this.store
      .list()
      .filter((entry) => this.isOwnedBy(entry.record, owner))
      .map((entry) => entry.record)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private requireOwned(jobId: string, owner?: JobOwner): StoredJob {
    const entry = this.store.find(jobId);
    if (!entry || !this.isOwnedBy(entry.record, owner)) {
      throw new JobNotFoundError(jobId);
    }
    return entry;
  }

  private isOwnedBy(record: JobRecord, owner?: JobOwner): boolean {
    if (!owner) {
      return true; // the admin key can see and cancel every job
    }
    return record.owner?.tenant === owner.tenant && record.owner?.appId === owner.appId;
  }

  private async processNext(): Promise<void> {
    if (this.worker.isBusy()) {
      return;
    }
    const jobId = this.pendingIds.shift();
    if (!jobId) {
      return;
    }
    const entry = this.store.find(jobId);
    if (!entry || entry.record.status !== 'pending') {
      void this.processNext();
      return;
    }

    this.transition(entry, 'printing');
    const outcome = await this.worker.run(entry.record.jobId, entry.job);
    this.transition(entry, outcome.status, outcome.status === 'failed' ? outcome.message : undefined);

    if (this.pendingIds.length > 0) {
      void this.processNext();
    }
  }

  private transition(entry: StoredJob, status: JobStatus, message?: string): PrintJobResult {
    entry.record.status = status;
    entry.record.updatedAt = new Date().toISOString();
    if (message !== undefined) {
      entry.record.message = message;
    }
    this.store.upsert(entry);
    this.broadcast(entry.record);
    return { jobId: entry.record.jobId, status: entry.record.status, message: entry.record.message };
  }

  private broadcast(record: JobRecord): void {
    this.wsManager?.broadcast(EVENT_BY_STATUS[record.status], record);
  }
}
