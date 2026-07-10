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
import { registerShutdown } from './shutdown.service.js';

export interface RuntimeContext {
  server: Server;
  wsManager: WebSocketManager;
  logger: LoggerService;
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

  const server = createApiServer({ configService, logger, queueService, printerManager, pairingService, metricsService });
  // A second, stateless AuthService instance (it only wraps pairingService,
  // already shared) — kept separate from createApiServer's own so the
  // WebSocket upgrade check doesn't require reshaping that function's
  // return contract just to expose its internal auth instance.
  const auth = new AuthService(pairingService);
  const wsManager = new WebSocketManager(server, auth, () => configService.get().apiKey, logger);
  queueService.attachWebSocketManager(wsManager);
  metricsService.attachWebSocketManager(wsManager);
  queueService.recover();

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, resolve);
  });

  logger.info(`Runtime online at http://${config.host}:${config.port}`);

  const context: RuntimeContext = { server, wsManager, logger };
  registerShutdown(context);
  return context;
}
