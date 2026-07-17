import type { IncomingMessage, ServerResponse } from 'node:http';
import { DASHBOARD_HTML } from './dashboard/dashboard.page.js';
import { readJsonBody } from '../protocol/protocol.adapter.js';
import type { ConfigService } from '../config/config.service.js';

/**
 * Serves the Runtime Control Center — the local status and setup surface (ROADMAP Fase 3/5).
 * The page itself lives in `dashboard/`, composed from one section per screen; this file is just
 * the HTTP edge.
 */
export function handleDashboard(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(DASHBOARD_HTML);
}

/**
 * Sets the machine's single global default printer.
 *
 * Kept after printer targets replaced the printer-first model, because it is still the `receipt`
 * fallback for installs configured before targets existed (see PrinterTargetsService). The Control
 * Center no longer exposes it — new configuration goes through targets — but the endpoint stays so
 * those installs keep printing.
 */
export async function handleSetDefaultPrinter(
  req: IncomingMessage,
  res: ServerResponse,
  configService: ConfigService,
): Promise<void> {
  const payload = await readJsonBody<{ printerName?: string }>(req);
  const printerName = payload?.printerName;
  if (!printerName || typeof printerName !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'INVALID_REQUEST', message: '"printerName" is required' }));
    return;
  }
  configService.setDefaultPrinter(printerName);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ defaultPrinter: printerName }));
}
