import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import nodeWindows from 'node-windows';

const { Service } = nodeWindows;
const runtimeRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const svc = new Service({
  name: 'PortixOne Runtime',
  script: join(runtimeRoot, 'scripts', 'service-entry.js'),
});

svc.on('uninstall', () => {
  console.log('PortixOne Runtime service uninstalled.');
});

svc.on('error', (error) => {
  console.error('Service error:', error);
  process.exitCode = 1;
});

svc.uninstall();
