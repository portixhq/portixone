import type { IncomingMessage } from 'node:http';
import { PayloadTooLargeError } from '@portixone/shared';

// Receipts can carry a logo/QR bitmap, so this is generous, but every JSON
// body on this server — including /pairing/request, reachable with no
// credential at all — went through this same unbounded read before. Without
// a cap, a single client could exhaust the process's memory with an
// unbounded stream and no API key needed.
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function readJsonBody<T>(req: IncomingMessage, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<T> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += (chunk as Buffer).length;
    if (totalBytes > maxBytes) {
      // Not req.destroy() — that tears down the underlying socket res still
      // needs to send the 413 itself (found by testing: the client saw a
      // broken connection instead of an actual 413 response). Just stop
      // reading; the caller's catch-all still writes a normal error response.
      throw new PayloadTooLargeError(maxBytes);
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}
