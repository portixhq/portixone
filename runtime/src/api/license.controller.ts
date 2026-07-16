import type { ServerResponse } from 'node:http';
import type { LicenseService } from '../license/license.service.js';

/**
 * Admin-only view of the runtime's current license posture (plan §4). This is a READ of state,
 * never a gate — the print path never consults it. It exists so the local dashboard, the tray,
 * and eventually the Portal can show "Development", "Launch Trial — 6 days left", "Production
 * active", or "Action required" without inferring it from logs. Never surfaced to an end customer;
 * tickets carry no license state.
 */
export function handleLicenseStatus(res: ServerResponse, licenseService: LicenseService): void {
  const state = licenseService.getState();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      posture: state.posture,
      applicationId: state.applicationId,
      licenseType: state.licenseType,
      applicationStatus: state.applicationStatus,
      tokenExpiresAt: state.tokenExpiresAt ? new Date(state.tokenExpiresAt).toISOString() : undefined,
      lastRenewedAt: state.lastRenewedAt ? new Date(state.lastRenewedAt).toISOString() : undefined,
    }),
  );
}
