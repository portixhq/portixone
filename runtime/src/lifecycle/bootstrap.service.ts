import type { Server } from 'node:http';
import { ConfigService } from '../config/config.service.js';
import { LoggerService } from '../logger/logger.service.js';
import { PrinterManager } from '../printer/printer.manager.js';
import { QueueStore } from '../queue/queue.store.js';
import { QueueWorker } from '../queue/queue.worker.js';
import { QueueService } from '../queue/queue.service.js';
import { PairingStore } from '../pairing/pairing.store.js';
import { PairingService } from '../pairing/pairing.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { createApiServer } from '../api/api.route.js';
import { WebSocketManager } from '../api/websocket.manager.js';
import { AuthService } from '../auth/auth.service.js';
import { LicenseService } from '../license/license.service.js';
import { HeartbeatService } from '../license/heartbeat.service.js';
import { InstallationService } from '../license/installation.service.js';
import { registerShutdown } from './shutdown.service.js';

export interface RuntimeContext {
  server: Server;
  wsManager: WebSocketManager;
  logger: LoggerService;
  heartbeat: HeartbeatService;
}

export async function bootstrap(): Promise<RuntimeContext> {
  const configService = new ConfigService();
  const config = configService.load();

  const logger = new LoggerService();
  logger.info('Starting PortixOne Runtime', {
    host: config.host,
    port: config.port,
    printerDriver: config.printerDriver,
  });

  const printerManager = new PrinterManager(config, logger);
  const queueStore = new QueueStore();
  const queueWorker = new QueueWorker(printerManager, logger);
  const queueService = new QueueService(queueStore, queueWorker, logger);
  const pairingStore = new PairingStore();
  const pairingService = new PairingService(pairingStore);
  const metricsService = new MetricsService(queueStore, pairingStore);

  // Licensing (plan §4). Resolved at boot from the cached token; posture drives dashboard/log
  // messaging only. INVARIANT: nothing here touches the print path — a license lapse or a Cloud
  // outage never stops local printing.
  const licenseService = new LicenseService(logger, { applicationId: config.applicationId });
  licenseService.load();
  // Consume a one-time installation token, if the installer wrote one (plan §9). Idempotent and
  // best-effort: inert for a plain dev runtime, never throws, never blocks printing.
  const installationService = new InstallationService(logger, licenseService, {
    installationToken: config.installationToken,
    registrationUrl: config.licenseRegistrationUrl,
  });
  await installationService.registerIfNeeded();
  const heartbeat = new HeartbeatService(licenseService, logger, {
    heartbeatUrl: config.licenseHeartbeatUrl,
    applicationId: config.applicationId,
  });

  const server = createApiServer({ configService, logger, queueService, printerManager, pairingService, metricsService, licenseService });
  // A second, stateless AuthService instance (it only wraps pairingService,
  // already shared) — kept separate from createApiServer's own so the
  // WebSocket upgrade check doesn't require reshaping that function's
  // return contract just to expose its internal auth instance.
  const auth = new AuthService(pairingService);
  const wsManager = new WebSocketManager(server, auth, () => configService.get().apiKey, logger);
  queueService.attachWebSocketManager(wsManager);
  metricsService.attachWebSocketManager(wsManager);
  queueService.recover();
  heartbeat.start();

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, resolve);
  });

  logger.info(`Runtime online at http://${config.host}:${config.port}`);

  const context: RuntimeContext = { server, wsManager, logger, heartbeat };
  registerShutdown(context);
  return context;
}
