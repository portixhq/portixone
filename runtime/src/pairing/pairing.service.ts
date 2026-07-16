import { randomInt, randomUUID } from 'node:crypto';
import type {
  PairingRecord,
  PairingRequestResult,
  PairingStatusResult,
  PendingPairingSummary,
  Permission,
} from '@portixone/protocol';
import { PairingNotFoundError } from '@portixone/shared';
import { PairingStore } from './pairing.store.js';

/** Excludes visually ambiguous characters (0/O, 1/I) — this code gets typed by a human. */
const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 5 * 60 * 1000;
/** How long an approved code stays queryable via status() before the pending entry is dropped. */
const APPROVED_GRACE_MS = 2 * 60 * 1000;
const DEFAULT_PERMISSIONS: Permission[] = ['print'];

/**
 * A pairing request from localhost never needs a human to click "Allow" —
 * only code already running on this same machine can make the Runtime see
 * that as the request's Origin, which is as strong a signal as "this is the
 * same developer's own machine" gets.
 *
 * Deliberately NOT extended to LAN/private-IP origins (10.x/172.16-31.x/
 * 192.168.x), despite that once being the design here: `Origin` is a plain,
 * unauthenticated HTTP header on this raw endpoint, not something only a
 * real browser can set — anything on the same network segment (not just a
 * browser) can send `Origin: http://192.168.x.x` by hand and get an
 * unattended, permanent print-capable token. Loopback doesn't have that gap:
 * reaching 127.0.0.1/::1 already means code execution on this exact host,
 * which is a materially higher bar than "somewhere on the LAN."
 */
function isTrustedOrigin(origin?: string): boolean {
  if (!origin) {
    return false;
  }
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

interface PendingPairing {
  tenant: string;
  appId: string;
  origin?: string;
  expiresAt: number;
  approved?: { token: string; deviceId: string; permissions: Permission[]; approvedAt: number };
}

// Uses crypto randomInt, not Math.random: knowing a pending code is enough to
// retrieve the approved token via the unauthenticated GET /pairing/status,
// so the code must not be predictable from prior outputs (a Math.random PRNG
// state can be recovered from observed values).
function generateCode(): string {
  const segment = (): string =>
    Array.from({ length: 4 }, () => CODE_CHARSET[randomInt(CODE_CHARSET.length)]).join('');
  return `${segment()}-${segment()}`;
}

/**
 * Pairing codes live only in memory (they're single-use and short-lived) —
 * only approved pairings are persisted, via `PairingStore`.
 */
export class PairingService {
  private readonly pending = new Map<string, PendingPairing>();

  constructor(private readonly store: PairingStore) {}

  request(tenant: string, appId: string, origin?: string): PairingRequestResult {
    this.evictStale();
    const code = generateCode();
    const expiresAt = Date.now() + CODE_TTL_MS;
    const entry: PendingPairing = { tenant, appId, origin, expiresAt };
    this.pending.set(code, entry);
    if (isTrustedOrigin(origin)) {
      // No human ever sees this one — status() below already returns
      // 'approved' by the time the SDK's first poll comes in.
      this.approveEntry(entry);
    }
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  approve(code: string): PairingRecord {
    this.evictStale();
    const entry = this.pending.get(code);
    if (!entry || entry.expiresAt < Date.now()) {
      this.pending.delete(code);
      throw new PairingNotFoundError();
    }
    return this.approveEntry(entry);
  }

  /** Revokes a paired app immediately — any request using its token fails with INVALID_API_KEY from then on. */
  revoke(deviceId: string): boolean {
    return this.store.remove(deviceId);
  }

  /** Rejects a still-pending request outright, instead of just letting it sit until it expires on its own. */
  deny(code: string): boolean {
    this.evictStale();
    const entry = this.pending.get(code);
    if (!entry || entry.approved) {
      return false;
    }
    this.pending.delete(code);
    return true;
  }

  /** Bumps a paired app's last-used timestamp — called on every authenticated request (see auth.service.ts). */
  touch(deviceId: string): void {
    this.store.touchLastUsed(deviceId);
  }

  private approveEntry(entry: PendingPairing): PairingRecord {
    const requestedAt = entry.expiresAt - CODE_TTL_MS;
    const record: PairingRecord = {
      tenant: entry.tenant,
      appId: entry.appId,
      deviceId: randomUUID(),
      token: randomUUID(),
      origin: entry.origin,
      permissions: DEFAULT_PERMISSIONS,
      pairedAt: new Date().toISOString(),
      pairingDurationMs: Date.now() - requestedAt,
    };

    this.store.add(record);
    entry.approved = {
      token: record.token,
      deviceId: record.deviceId,
      permissions: record.permissions,
      approvedAt: Date.now(),
    };
    return record;
  }

  status(code: string): PairingStatusResult {
    this.evictStale();
    const entry = this.pending.get(code);
    if (!entry) {
      throw new PairingNotFoundError();
    }
    if (entry.approved) {
      return {
        status: 'approved',
        token: entry.approved.token,
        deviceId: entry.approved.deviceId,
        permissions: entry.approved.permissions,
      };
    }
    if (entry.expiresAt < Date.now()) {
      return { status: 'expired' };
    }
    return { status: 'pending' };
  }

  findByToken(token: string): PairingRecord | undefined {
    return this.store.findByToken(token);
  }

  listPaired(): PairingRecord[] {
    return this.store.list();
  }

  /** Requests waiting on a human to approve them — what the tray's Pairing Requests menu polls. */
  listPending(): PendingPairingSummary[] {
    this.evictStale();
    return [...this.pending.entries()]
      .filter(([, entry]) => !entry.approved)
      .map(([code, entry]) => ({
        code,
        tenant: entry.tenant,
        appId: entry.appId,
        expiresAt: new Date(entry.expiresAt).toISOString(),
        origin: entry.origin,
      }));
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [code, entry] of this.pending) {
      const unapprovedAndExpired = !entry.approved && entry.expiresAt < now;
      const approvedPastGrace = entry.approved !== undefined && entry.approved.approvedAt + APPROVED_GRACE_MS < now;
      if (unapprovedAndExpired || approvedPastGrace) {
        this.pending.delete(code);
      }
    }
  }
}
