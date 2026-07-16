import type { RuntimeContext } from './bootstrap.service.js';

export function registerShutdown(context: RuntimeContext): void {
  const shutdown = (signal: string): void => {
    context.logger.info(`Received ${signal}, shutting down runtime`);
    context.heartbeat.stop();
    context.wsManager.close();
    context.server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
