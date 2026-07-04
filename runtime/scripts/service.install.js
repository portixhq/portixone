import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import nodeWindows from 'node-windows';

const { Service } = nodeWindows;
const runtimeRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const svc = new Service({
  name: 'PortixOne Runtime',
  description:
    'PortixOne local hardware bridge — HTTP + WebSocket API for printing and other local devices.',
  script: join(runtimeRoot, 'scripts', 'service-entry.js'),
});

svc.on('alreadyinstalled', () => {
  console.log('PortixOne Runtime service is already installed.');
});

svc.on('install', () => {
  console.log('PortixOne Runtime service installed. Starting it...');
  svc.start();
});

svc.on('start', () => {
  console.log('PortixOne Runtime service is running.');
});

svc.on('error', (error) => {
  console.error('Service error:', error);
  process.exitCode = 1;
});

svc.install();
