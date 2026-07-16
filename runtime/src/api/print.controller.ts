import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JobOwner, PrintJobInput } from '@portixone/protocol';
import { readJsonBody } from '../protocol/protocol.adapter.js';
import { validatePrintJob } from '../protocol/protocol.validator.js';
import type { QueueService } from '../queue/queue.service.js';
import type { AuthContext } from '../auth/auth.service.js';
import type { PrinterTargetsService, TargetScope } from '../printer/printer-targets.service.js';

/**
 * Scope used for prints placed with the admin key rather than by a paired app — the local dashboard's
 * test print, mostly. It gets its own target configuration like any app, instead of being a special
 * case in the resolver.
 */
export const ADMIN_APP_ID = '(admin)';

export function scopeFor(context: AuthContext): TargetScope {
  return { appId: context.appId ?? ADMIN_APP_ID, origin: context.origin };
}

/**
 * Turns whatever the caller asked for into a concrete printer name.
 *
 * Resolution happens HERE, at enqueue, not in the queue worker: an unconfigured target is a
 * configuration gap the Runtime already knows about, so the caller deserves an immediate, actionable
 * error rather than a 202 followed by a job that quietly fails later. Hardware problems still surface
 * at print time — those genuinely aren't knowable up front.
 */
export function resolveJobPrinter(
  job: PrintJobInput,
  printerTargets: PrinterTargetsService,
  context: AuthContext,
): PrintJobInput {
  // Explicit printerName wins: it's the advanced/compat escape hatch, and second-guessing it would
  // break the callers who legitimately know their own hardware.
  if (job.printerName) {
    return job;
  }
  if (!job.target) {
    // Neither target nor printerName — the pre-targets contract. The driver falls back to the
    // machine's configured default, exactly as before, so existing integrations keep working.
    return job;
  }
  return { ...job, printerName: printerTargets.resolve(scopeFor(context), job.target) };
}

export async function handlePrint(
  req: IncomingMessage,
  res: ServerResponse,
  queueService: QueueService,
  printerTargets: PrinterTargetsService,
  context: AuthContext,
  owner?: JobOwner,
): Promise<void> {
  const payload = await readJsonBody<unknown>(req);
  const job = validatePrintJob(payload);
  const resolved = resolveJobPrinter(job, printerTargets, context);
  const result = queueService.enqueue(resolved, owner);
  res.writeHead(202, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}
