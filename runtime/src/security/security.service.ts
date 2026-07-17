import type { ServerResponse } from 'node:http';
import { API_KEY_HEADER } from '@portixone/protocol';

/**
 * Local web apps run on arbitrary origins (any dev/prod domain), so the
 * runtime must allow cross-origin requests by design — the actual gate is
 * the API key, not CORS. This service only sets the headers that make that
 * possible from a browser.
 */
export class SecurityService {
  applyCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    // PUT and DELETE are here because a real integrator's browser app configures printer targets
    // (PUT /printer-targets/...) and removes them (DELETE) cross-origin through the SDK. Their
    // absence blocked exactly that: the browser's preflight rejected the method, the fetch failed,
    // and setup() reported the Runtime as unreachable. The same-origin dashboard never hit it.
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${API_KEY_HEADER}`);
    // Chrome's Private Network Access requires this on the preflight when the
    // calling page was loaded from a public origin (e.g. portix.one) and the
    // target is a private/loopback address (this runtime, always localhost)
    // — without it, real browser calls from the public landing page fail.
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}
