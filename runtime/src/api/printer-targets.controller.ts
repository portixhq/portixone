import type { IncomingMessage, ServerResponse } from 'node:http';
import { PRINT_TARGETS, type PrintTarget } from '@portixone/protocol';
import { InvalidRequestError, PrinterNotFoundError } from '@portixone/shared';
import { readJsonBody } from '../protocol/protocol.adapter.js';
import type { PrinterManager } from '../printer/printer.manager.js';
import type { PrinterTargetsService, TargetScope } from '../printer/printer-targets.service.js';
import type { QueueService } from '../queue/queue.service.js';
import type { AuthContext } from '../auth/auth.service.js';
import { scopeFor } from './print.controller.js';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Which (appId, origin) a target operation acts on.
 *
 * A paired app is pinned to its own origin and cannot ask for another — that's the isolation
 * boundary. The admin key has no pairing and therefore no origin of its own, so it MUST be able to
 * name the origin it's acting on: without this, every admin operation would silently fall into the
 * originless `*` bucket and the local dashboard could never test or remove a real app's target.
 */
function scopeForTarget(context: AuthContext, appId: string, requestedOrigin?: string | null): TargetScope {
  if (context.isAdmin) {
    return { appId, origin: requestedOrigin ?? undefined };
  }
  return { appId, origin: scopeFor(context).origin };
}

export function assertPrintTarget(value: string): PrintTarget {
  if (!(PRINT_TARGETS as readonly string[]).includes(value)) {
    throw new InvalidRequestError(`"${value}" is not a print target. Valid targets: ${PRINT_TARGETS.join(', ')}.`);
  }
  return value as PrintTarget;
}

/** The caller's own target configuration — what a paired app reads to know whether it's set up. */
export function handleGetOwnTargets(
  res: ServerResponse,
  printerTargets: PrinterTargetsService,
  context: AuthContext,
): void {
  const scope = scopeFor(context);
  json(res, 200, printerTargets.list(scope.appId, scope.origin));
}

/** Every application/origin configured on this machine — admin only, for the dashboard. */
export function handleListAllTargets(res: ServerResponse, printerTargets: PrinterTargetsService): void {
  json(res, 200, { configurations: printerTargets.listAll() });
}

export function handleGetTargetsForApp(
  res: ServerResponse,
  printerTargets: PrinterTargetsService,
  appId: string,
): void {
  json(res, 200, { configurations: printerTargets.listAll().filter((view) => view.appId === appId) });
}

/**
 * Assigns a printer to a target. The printer must actually exist on this machine — accepting a name
 * nobody can print to would just move the failure to the first real receipt.
 */
export async function handleSetTarget(
  req: IncomingMessage,
  res: ServerResponse,
  printerTargets: PrinterTargetsService,
  printerManager: PrinterManager,
  context: AuthContext,
  appId: string,
  targetName: string,
): Promise<void> {
  const target = assertPrintTarget(targetName);
  const body = await readJsonBody<{ printerName?: unknown; origin?: unknown }>(req);
  if (typeof body?.printerName !== 'string' || body.printerName.length === 0) {
    throw new InvalidRequestError('printerName is required');
  }

  const printers = await printerManager.listPrinters().catch(() => []);
  if (printers.length > 0 && !printers.some((p) => p.name === body.printerName)) {
    throw new PrinterNotFoundError(body.printerName);
  }

  const scope = scopeForTarget(context, appId, typeof body.origin === 'string' ? body.origin : undefined);
  const mapping = printerTargets.set(scope, target, body.printerName);
  json(res, 200, { appId, origin: scope.origin ?? '*', target, mapping });
}

export function handleDeleteTarget(
  res: ServerResponse,
  printerTargets: PrinterTargetsService,
  context: AuthContext,
  appId: string,
  targetName: string,
  requestedOrigin?: string | null,
): void {
  const target = assertPrintTarget(targetName);
  const removed = printerTargets.remove(scopeForTarget(context, appId, requestedOrigin), target);
  json(res, removed ? 200 : 404, { appId, target, removed });
}

/**
 * Prints a test ticket through a target, so setup can end with a human confirming that paper came
 * out of the right device. Resolution runs the same path a real receipt takes — if this ticket
 * prints, the mapping works.
 */
export async function handleTestTarget(
  res: ServerResponse,
  printerTargets: PrinterTargetsService,
  queueService: QueueService,
  context: AuthContext,
  appId: string,
  targetName: string,
  requestedOrigin?: string | null,
): Promise<void> {
  const target = assertPrintTarget(targetName);
  const scope = scopeForTarget(context, appId, requestedOrigin);
  const printerName = printerTargets.resolve(scope, target);
  const result = queueService.enqueue({
    content: [
      'PortixOne test ticket',
      `Target:  ${target}`,
      `Printer: ${printerName}`,
      new Date().toLocaleString(),
      '',
      'If you can read this, the target is wired correctly.',
    ].join('\n'),
    target,
    printerName,
  });
  json(res, 202, { ...result, target, printerName });
}

/** Confirms a human actually saw the test ticket — the difference between "assigned" and "verified". */
export function handleConfirmTarget(
  res: ServerResponse,
  printerTargets: PrinterTargetsService,
  context: AuthContext,
  appId: string,
  targetName: string,
  requestedOrigin?: string | null,
): void {
  const target = assertPrintTarget(targetName);
  const mapping = printerTargets.markVerified(scopeForTarget(context, appId, requestedOrigin), target);
  json(res, mapping ? 200 : 404, { appId, target, mapping });
}
