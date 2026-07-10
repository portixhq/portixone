import { API_KEY_HEADER } from '@portixone/protocol';
import type { PairedAppSummary, PendingPairingSummary, PrinterInfo } from '@portixone/protocol';
import type { RuntimeConnection } from './runtime-config.js';

const REQUEST_TIMEOUT_MS = 3000;

async function authenticatedGet<T>(connection: RuntimeConnection, path: string): Promise<T | undefined> {
  try {
    const response = await fetch(`http://${connection.host}:${connection.port}${path}`, {
      headers: { [API_KEY_HEADER]: connection.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

export function listPrinters(connection: RuntimeConnection): Promise<PrinterInfo[] | undefined> {
  return authenticatedGet<PrinterInfo[]>(connection, '/printers');
}

export function listPendingPairings(connection: RuntimeConnection): Promise<PendingPairingSummary[] | undefined> {
  return authenticatedGet<PendingPairingSummary[]>(connection, '/pairing/pending');
}

export function listPairedApps(connection: RuntimeConnection): Promise<PairedAppSummary[] | undefined> {
  return authenticatedGet<PairedAppSummary[]>(connection, '/pairings');
}

export async function revokePairing(connection: RuntimeConnection, deviceId: string): Promise<boolean> {
  try {
    const response = await fetch(`http://${connection.host}:${connection.port}/pairings/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
      headers: { [API_KEY_HEADER]: connection.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function approvePairing(connection: RuntimeConnection, code: string): Promise<boolean> {
  try {
    const response = await fetch(`http://${connection.host}:${connection.port}/pairing/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [API_KEY_HEADER]: connection.apiKey },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Longer timeout than authenticatedGet's default — building the zip involves a live printer detection sweep, not just a disk read. */
const DIAGNOSTICS_TIMEOUT_MS = 10000;

export async function downloadDiagnostics(connection: RuntimeConnection): Promise<Buffer | undefined> {
  try {
    const response = await fetch(`http://${connection.host}:${connection.port}/diagnostics`, {
      headers: { [API_KEY_HEADER]: connection.apiKey },
      signal: AbortSignal.timeout(DIAGNOSTICS_TIMEOUT_MS),
    });
    if (!response.ok) {
      return undefined;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return undefined;
  }
}
