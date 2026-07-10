import { registerCrashHandlers } from './lifecycle/crash-handler.js';
import { bootstrap } from './lifecycle/bootstrap.service.js';

registerCrashHandlers();

bootstrap().catch((error: unknown) => {
  console.error('Failed to start PortixOne Runtime:', error);
  process.exit(1);
});
