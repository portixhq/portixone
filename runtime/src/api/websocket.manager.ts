import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { WS_EVENTS } from '@portixone/protocol';
import type { AuthService } from '../auth/auth.service.js';
import type { LoggerService } from '../logger/logger.service.js';

export class WebSocketManager {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  /**
   * Every client disconnect since boot — a proxy for "reconexiones" (Milestone
   * 4's metrics ask) until the SDK's WebSocket client actually implements
   * reconnect-on-drop, which it doesn't yet (see MILESTONE_3.md Phase 3).
   */
  private totalDisconnects = 0;

  /**
   * One security model regardless of protocol: HTTP requires a key, so this
   * does too — same `AuthService.authenticate()` every HTTP endpoint already
   * uses (admin key or a valid paired-app token), checked before the
   * handshake completes. A native browser WebSocket can't set custom
   * headers, so the key travels as a `?key=` query param instead — the only
   * channel available (RuntimeSocket, the SDK's client, sends it this way).
   */
  constructor(httpServer: Server, auth: AuthService, getAdminKey: () => string, logger: LoggerService) {
    this.wss = new WebSocketServer({
      server: httpServer,
      verifyClient: ({ req }, callback) => {
        const key = new URL(req.url ?? '/', 'http://localhost').searchParams.get('key') ?? undefined;
        try {
          auth.authenticate(key, getAdminKey());
          callback(true);
        } catch {
          logger.warn('Rejected WebSocket connection — missing or invalid API key');
          callback(false, 401, 'Unauthorized');
        }
      },
    });
    this.wss.on('connection', (socket) => {
      this.clients.add(socket);
      socket.send(JSON.stringify({ event: WS_EVENTS.STATUS, data: { status: 'online' } }));
      socket.on('close', () => {
        this.clients.delete(socket);
        this.totalDisconnects += 1;
      });
    });
  }

  getStats(): { activeConnections: number; totalDisconnects: number } {
    return { activeConnections: this.clients.size, totalDisconnects: this.totalDisconnects };
  }

  broadcast(event: string, data: unknown): void {
    const message = JSON.stringify({ event, data });
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  }

  close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.wss.close();
  }
}
