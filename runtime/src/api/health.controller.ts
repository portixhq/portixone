import type { ServerResponse } from 'node:http';
import { PROTOCOL_VERSION, type RuntimeStatus } from '@portixone/protocol';
import { APP_VERSION } from '@portixone/shared';
import type { ConfigService } from '../config/config.service.js';

export function handleHealth(res: ServerResponse, configService: ConfigService): void {
  const config = configService.get();
  const body: RuntimeStatus = {
    status: 'online',
    // `version` keeps carrying the protocol version for existing callers; the two explicit fields
    // below are what anything new should read. See RuntimeStatus for why this was ambiguous.
    version: PROTOCOL_VERSION,
    runtimeVersion: APP_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    defaultPrinter: config.defaultPrinter,
    simulated: config.printerDriver === 'mock',
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
