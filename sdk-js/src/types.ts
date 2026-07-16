import { WS_EVENTS } from '@portixone/protocol';

export type { PrintJob as PrintOptions } from '@portixone/protocol';
export type {
  PrintJobResult as PrintResult,
  RuntimeStatus as RuntimeStatusResult,
  PrinterInfo,
  JobRecord,
  JobOwner,
  PairingRequestResult,
  PairingStatusResult,
  RuntimeMetrics,
  PrintTarget,
  PrinterTargetMapping,
  PrinterTargetsView,
} from '@portixone/protocol';
export { PRINT_TARGETS } from '@portixone/protocol';

export interface PortixClientOptions {
  apiKey: string;
  host?: string;
  port?: number;
}

export interface PortixOptions {
  /** Defaults to the local-dev convention (`runtime/.env.example`'s `PORTIX_LOCAL_API_KEY`). */
  apiKey?: string;
  host?: string;
  port?: number;
  /**
   * `"runtime"` (default) talks to a real Portix Runtime. `"mock"` needs no
   * runtime and no printer at all — `print()` renders a text preview of the
   * receipt instead, so a stranger can try the SDK in one command.
   *
   * This is a NON-AUTHORITATIVE convenience hint, never a production switch:
   * whether an Application is licensed for commercial production is decided by
   * the Runtime and a cloud-signed license token, never by a value the browser
   * sets (licensing plan §5, §7). Setting `mode: "runtime"` does not "turn on"
   * production, and it never affects billing.
   */
  mode?: 'runtime' | 'mock';
  /**
   * This integration's identity with the runtime — and, once registered in the
   * Portix Developer Portal, the **public Application ID** (`app_<slug>_<rand>`)
   * the license token is bound to (licensing plan §5). It is public by design:
   * only a public identifier and a public integration key ever ship in a browser
   * bundle — never a secret. Required for `connect()` to pair automatically, and
   * to call `pair()` directly.
   */
  appId?: string;
  /** The specific business/customer this connection is on behalf of. Required for `connect()` to pair automatically, and to call `pair()` directly. */
  tenant?: string;
}

/** The real-time events the runtime pushes over WebSocket, plus the SDK-local `paired` event. */
export type RuntimeEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
export type PortixEvent = RuntimeEvent | 'paired';
export type PortixEventHandler = (data: unknown) => void;
