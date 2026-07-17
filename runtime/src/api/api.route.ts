import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PortixError } from '@portixone/shared';
import { AuthService, type AuthContext } from '../auth/auth.service.js';
import { assertAdmin, assertAuthenticated, assertOwnAppOrAdmin, assertPermission } from '../auth/auth.middleware.js';
import { SecurityService } from '../security/security.service.js';
import type { ConfigService } from '../config/config.service.js';
import type { LoggerService } from '../logger/logger.service.js';
import type { JobOwner } from '@portixone/protocol';
import type { QueueService } from '../queue/queue.service.js';
import type { PrinterManager } from '../printer/printer.manager.js';
import type { PairingService } from '../pairing/pairing.service.js';
import type { MetricsService } from '../metrics/metrics.service.js';
import type { LicenseService } from '../license/license.service.js';
import type { PrinterTargetsService } from '../printer/printer-targets.service.js';
import { handleHealth } from './health.controller.js';
import { handleLicenseStatus } from './license.controller.js';
import {
  handleConfirmTarget,
  handleDeleteTarget,
  handleGetOwnTargets,
  handleGetTargetsForApp,
  handleListAllTargets,
  handleSetTarget,
  handleTestTarget,
} from './printer-targets.controller.js';
import { handleDashboard, handleSetDefaultPrinter } from './dashboard.controller.js';
import { handlePairingApprovalUI } from './pairing-ui.controller.js';
import { handlePrint } from './print.controller.js';
import { handleGetPrinter, handleListPrinters } from './printers.controller.js';
import { handleCancelJob, handleGetJobs } from './jobs.controller.js';
import { handleGetMetrics } from './metrics.controller.js';
import { handleDiagnostics } from './diagnostics.controller.js';
import {
  handleListPairings,
  handleListPendingPairings,
  handlePairingApprove,
  handlePairingDeny,
  handlePairingRequest,
  handlePairingRevoke,
  handlePairingStatus,
} from './pairing.controller.js';

interface RouteDeps {
  configService: ConfigService;
  logger: LoggerService;
  queueService: QueueService;
  printerManager: PrinterManager;
  pairingService: PairingService;
  metricsService: MetricsService;
  licenseService: LicenseService;
  printerTargets: PrinterTargetsService;
}

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  INVALID_API_KEY: 401,
  PRINTER_NOT_FOUND: 404,
  INVALID_PRINT_JOB: 400,
  INVALID_REQUEST: 400,
  JOB_NOT_FOUND: 404,
  PAIRING_NOT_FOUND: 404,
  UNTRUSTED_ORIGIN: 403,
  PERMISSION_DENIED: 403,
  JOB_NOT_CANCELLABLE: 409,
  PRINTER_OFFLINE: 503,
  PAPER_OUT: 503,
  CONNECTION_LOST: 503,
  PRINTER_TIMEOUT: 503,
  PRINTER_BUSY: 409,
  PRINTER_NOT_READY: 503,
  INVALID_DRIVER_CONFIG: 503,
  PRINTER_CONNECTION_FAILED: 503,
  PAYLOAD_TOO_LARGE: 413,
  // 409, not 400: the request is perfectly well-formed — this machine just isn't set up for it yet,
  // which is a state the caller resolves by running printer setup, not by fixing its payload.
  TARGET_NOT_CONFIGURED: 409,
  MAPPING_INVALID: 409,
};

/** Admin key requests act on behalf of no single app; a paired token is scoped to its own tenant/app. */
function toOwner(context: AuthContext): JobOwner | undefined {
  if (context.isAdmin || !context.tenant || !context.appId) {
    return undefined;
  }
  return { tenant: context.tenant, appId: context.appId };
}

export function createApiServer({
  configService,
  logger,
  queueService,
  printerManager,
  pairingService,
  metricsService,
  licenseService,
  printerTargets,
}: RouteDeps): Server {
  const auth = new AuthService(pairingService);
  const security = new SecurityService();

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    security.applyCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    const adminKey = () => configService.get().apiKey;

    try {
      if (req.method === 'GET' && pathname === '/health') {
        handleHealth(res, configService);
        return;
      }

      if (req.method === 'GET' && pathname === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pong: true }));
        return;
      }

      // No auth on the page itself — it's static markup. The admin key
      // arrives via `?key=` (the tray already reads it straight off disk to
      // open this URL) and the page's own JS attaches it to every API call
      // it makes from there; same trust model as the tray's own access.
      if (req.method === 'GET' && pathname === '/dashboard') {
        handleDashboard(res);
        return;
      }

      if (req.method === 'GET' && pathname === '/pairing/approve-ui') {
        handlePairingApprovalUI(res);
        return;
      }

      if (req.method === 'POST' && pathname === '/config/default-printer') {
        const context = assertAuthenticated(req, auth, adminKey());
        assertAdmin(context);
        await handleSetDefaultPrinter(req, res, configService);
        return;
      }

      if (req.method === 'POST' && pathname === '/print') {
        const context = assertAuthenticated(req, auth, adminKey());
        assertPermission(context, 'print');
        await handlePrint(req, res, queueService, printerTargets, context, toOwner(context));
        return;
      }

      // A paired app reads its OWN target configuration — this is what tells it whether it still
      // needs to run printer setup, without exposing what other apps on this machine are doing.
      if (req.method === 'GET' && pathname === '/printer-targets') {
        const context = assertAuthenticated(req, auth, adminKey());
        if (context.isAdmin) {
          handleListAllTargets(res, printerTargets);
        } else {
          handleGetOwnTargets(res, printerTargets, context);
        }
        return;
      }

      const targetsForAppMatch = pathname.match(/^\/printer-targets\/([^/]+)$/);
      if (req.method === 'GET' && targetsForAppMatch) {
        const context = assertAuthenticated(req, auth, adminKey());
        assertAdmin(context);
        handleGetTargetsForApp(res, printerTargets, decodeURIComponent(targetsForAppMatch[1]));
        return;
      }

      const targetMatch = pathname.match(/^\/printer-targets\/([^/]+)\/([^/]+)$/);
      if (targetMatch) {
        const context = assertAuthenticated(req, auth, adminKey());
        const appId = decodeURIComponent(targetMatch[1]);
        const target = decodeURIComponent(targetMatch[2]);
        assertOwnAppOrAdmin(context, appId);
        if (req.method === 'PUT') {
          await handleSetTarget(req, res, printerTargets, printerManager, context, appId, target);
          return;
        }
        if (req.method === 'DELETE') {
          handleDeleteTarget(res, printerTargets, context, appId, target, url.searchParams.get('origin'));
          return;
        }
      }

      const targetTestMatch = pathname.match(/^\/printer-targets\/([^/]+)\/([^/]+)\/test$/);
      if (req.method === 'POST' && targetTestMatch) {
        const context = assertAuthenticated(req, auth, adminKey());
        const appId = decodeURIComponent(targetTestMatch[1]);
        assertOwnAppOrAdmin(context, appId);
        assertPermission(context, 'print');
        await handleTestTarget(
          res,
          printerTargets,
          queueService,
          context,
          appId,
          decodeURIComponent(targetTestMatch[2]),
          url.searchParams.get('origin'),
        );
        return;
      }

      const targetConfirmMatch = pathname.match(/^\/printer-targets\/([^/]+)\/([^/]+)\/confirm$/);
      if (req.method === 'POST' && targetConfirmMatch) {
        const context = assertAuthenticated(req, auth, adminKey());
        const appId = decodeURIComponent(targetConfirmMatch[1]);
        assertOwnAppOrAdmin(context, appId);
        handleConfirmTarget(
          res,
          printerTargets,
          context,
          appId,
          decodeURIComponent(targetConfirmMatch[2]),
          url.searchParams.get('origin'),
        );
        return;
      }

      if (req.method === 'GET' && pathname === '/printers') {
        assertAuthenticated(req, auth, adminKey());
        await handleListPrinters(res, printerManager);
        return;
      }

      const printerMatch = pathname.match(/^\/printers\/([^/]+)$/);
      if (req.method === 'GET' && printerMatch) {
        assertAuthenticated(req, auth, adminKey());
        await handleGetPrinter(res, printerManager, decodeURIComponent(printerMatch[1]));
        return;
      }

      if (req.method === 'GET' && pathname === '/jobs') {
        const context = assertAuthenticated(req, auth, adminKey());
        handleGetJobs(res, queueService, toOwner(context));
        return;
      }

      const cancelMatch = pathname.match(/^\/jobs\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && cancelMatch) {
        const context = assertAuthenticated(req, auth, adminKey());
        handleCancelJob(res, queueService, decodeURIComponent(cancelMatch[1]), toOwner(context));
        return;
      }

      if (req.method === 'POST' && pathname === '/pairing/request') {
        await handlePairingRequest(req, res, pairingService);
        return;
      }

      if (req.method === 'GET' && pathname === '/pairing/status') {
        handlePairingStatus(res, pairingService, url.searchParams.get('code'));
        return;
      }

      if (req.method === 'POST' && pathname === '/pairing/approve') {
        const context = assertAuthenticated(req, auth, adminKey());
        assertAdmin(context);
        await handlePairingApprove(req, res, pairingService);
        return;
      }

      if (req.method === 'POST' && pathname === '/pairing/deny') {
        const context = assertAuthenticated(req, auth, adminKey());
        assertAdmin(context);
        await handlePairingDeny(req, res, pairingService);
        return;
      }

      if (req.method === 'GET' && pathname === '/pairings') {
        const context = assertAuthenticated(req, auth, adminKey());
        assertAdmin(context);
        handleListPairings(res, pairingService, queueService);
        return;
      }

      const revokeMatch = pathname.match(/^\/pairings\/([^/]+)$/);
      if (req.method === 'DELETE' && revokeMatch) {
        const context = assertAuthenticated(req, auth, adminKey());
        assertAdmin(context);
        handlePairingRevoke(res, pairingService, decodeURIComponent(revokeMatch[1]));
        return;
      }

      if (req.method === 'GET' && pathname === '/pairing/pending') {
        const context = assertAuthenticated(req, auth, adminKey());
        assertAdmin(context);
        handleListPendingPairings(res, pairingService);
        return;
      }

      if (req.method === 'GET' && pathname === '/metrics') {
        const context = assertAuthenticated(req, auth, adminKey());
        assertAdmin(context);
        handleGetMetrics(res, metricsService);
        return;
      }

      if (req.method === 'GET' && pathname === '/diagnostics') {
        const context = assertAuthenticated(req, auth, adminKey());
        assertAdmin(context);
        await handleDiagnostics(res, configService, printerManager);
        return;
      }

      if (req.method === 'GET' && pathname === '/license') {
        const context = assertAuthenticated(req, auth, adminKey());
        assertAdmin(context);
        handleLicenseStatus(res, licenseService);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'NOT_FOUND',
          message: `No route for ${req.method} ${pathname}`,
        }),
      );
    } catch (error) {
      const err = error as Error & { code?: string };
      const status = error instanceof PortixError ? (STATUS_BY_ERROR_CODE[err.code!] ?? 400) : 500;

      if (status >= 500) {
        logger.error('Request failed', { url: pathname, error: err.message });
      } else {
        logger.warn('Request rejected', { url: pathname, error: err.message });
      }

      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: error instanceof PortixError ? err.code : 'INTERNAL_ERROR',
          message: err.message,
        }),
      );
    }
  });
}
