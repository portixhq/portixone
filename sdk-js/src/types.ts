export type { PrintJob as PrintOptions } from '@portixone/protocol';
export type { PrintJobResult as PrintResult, RuntimeStatus as RuntimeStatusResult } from '@portixone/protocol';

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
   */
  mode?: 'runtime' | 'mock';
}
