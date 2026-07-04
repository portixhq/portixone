import { ClientAdapter } from './client.adapter.js';
import { renderMockReceipt } from './mock-preview.js';
import type { PortixOptions, PrintOptions, PrintResult, RuntimeStatusResult } from './types.js';

const DEFAULT_LOCAL_API_KEY = 'dev-local-key';
const MOCK_VERSION = 'mock';

/**
 * The PortixOne SDK entry point.
 *
 * ```ts
 * const portix = new Portix();
 * await portix.connect();
 * await portix.print({ content: "Hello PortixOne!" });
 * ```
 *
 * Pass `{ mode: "mock" }` to try it with no runtime and no printer at all.
 */
export class Portix {
  private adapter?: ClientAdapter;
  private readonly mode: 'runtime' | 'mock';

  constructor(private readonly options: PortixOptions = {}) {
    this.mode = options.mode ?? 'runtime';
  }

  async connect(): Promise<void> {
    if (this.mode === 'mock') {
      return;
    }
    const adapter = new ClientAdapter({
      apiKey: this.options.apiKey ?? DEFAULT_LOCAL_API_KEY,
      host: this.options.host,
      port: this.options.port,
    });
    await adapter.getStatus();
    this.adapter = adapter;
  }

  async print(job: PrintOptions): Promise<PrintResult> {
    if (this.mode === 'mock') {
      return this.mockPrint(job);
    }
    return this.requireAdapter().print(job);
  }

  async getStatus(): Promise<RuntimeStatusResult> {
    if (this.mode === 'mock') {
      return { status: 'online', version: MOCK_VERSION };
    }
    return this.requireAdapter().getStatus();
  }

  private mockPrint(job: PrintOptions): PrintResult {
    console.log(renderMockReceipt(job));
    return {
      jobId: crypto.randomUUID(),
      status: 'printed',
      message: 'mock mode — no runtime or printer involved',
    };
  }

  private requireAdapter(): ClientAdapter {
    if (!this.adapter) {
      throw new Error('Call portix.connect() before using the client — no active connection to the PortixOne runtime.');
    }
    return this.adapter;
  }
}
