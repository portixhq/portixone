import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DEFAULT_NETWORK_PRINTER_PORT, DEFAULT_RUNTIME_HOST, DEFAULT_RUNTIME_PORT } from '@portixone/shared';
import { StorageRepository } from '../storage/storage.repository.js';
import { runtimeConfigSchema } from './config.schema.js';
import type { PrinterDriverType, RuntimeConfig } from './config.types.js';

const VALID_DRIVERS: PrinterDriverType[] = ['mock', 'network', 'windows-spooler'];

function resolvePrinterDriver(stored?: PrinterDriverType): PrinterDriverType {
  const fromEnv = process.env.PORTIX_PRINTER_DRIVER;
  if (fromEnv && VALID_DRIVERS.includes(fromEnv as PrinterDriverType)) {
    return fromEnv as PrinterDriverType;
  }
  return stored ?? 'mock';
}

export class ConfigService {
  private readonly storage = new StorageRepository<RuntimeConfig>(
    join(process.cwd(), '.data', 'config.json'),
  );
  private config: RuntimeConfig | undefined;

  load(): RuntimeConfig {
    if (this.config) {
      return this.config;
    }

    const stored = this.storage.read();
    const resolved: RuntimeConfig = {
      port: Number(process.env.PORTIX_RUNTIME_PORT) || stored?.port || DEFAULT_RUNTIME_PORT,
      host: process.env.PORTIX_RUNTIME_HOST || stored?.host || DEFAULT_RUNTIME_HOST,
      apiKey: process.env.PORTIX_LOCAL_API_KEY || stored?.apiKey || randomUUID(),
      defaultPrinter: process.env.PORTIX_DEFAULT_PRINTER || stored?.defaultPrinter,
      printerDriver: resolvePrinterDriver(stored?.printerDriver),
      networkPrinterHost: process.env.PORTIX_NETWORK_PRINTER_HOST || stored?.networkPrinterHost,
      networkPrinterPort:
        Number(process.env.PORTIX_NETWORK_PRINTER_PORT) ||
        stored?.networkPrinterPort ||
        DEFAULT_NETWORK_PRINTER_PORT,
      applicationId: process.env.PORTIX_APPLICATION_ID || stored?.applicationId,
      licenseHeartbeatUrl: process.env.PORTIX_LICENSE_HEARTBEAT_URL || stored?.licenseHeartbeatUrl,
      licenseRegistrationUrl: process.env.PORTIX_LICENSE_REGISTRATION_URL || stored?.licenseRegistrationUrl,
      installationToken: process.env.PORTIX_INSTALLATION_TOKEN || stored?.installationToken,
    };

    runtimeConfigSchema.parse(resolved);
    this.storage.write(resolved);
    this.config = resolved;
    return resolved;
  }

  get(): RuntimeConfig {
    if (!this.config) {
      throw new Error('Config not loaded yet — call load() first');
    }
    return this.config;
  }

  /** Persists the chosen default printer — used by the local dashboard's setup step. */
  setDefaultPrinter(name: string): void {
    const config = this.get();
    config.defaultPrinter = name;
    this.storage.write(config);
  }
}
