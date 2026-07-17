import type { PrintTarget } from './printer-target.types.js';

/**
 * The connection contract between an application and the Runtime.
 *
 * Why this exists: `connect()` used to resolve `void` and throw. That forced every application to
 * interpret technical exceptions to decide what to show a human — "is Portix missing, or stopped,
 * or waiting for approval, or just missing a printer?" — and made a deterministic onboarding screen
 * impossible. Operational conditions are now RETURNED as state; exceptions are reserved for things
 * that are genuinely unexpected.
 *
 * Every value here is something the SDK can actually observe. Two states from the original design
 * are deliberately absent:
 *
 *  - `runtime_not_installed` — indistinguishable from "installed but not running": a failed fetch is
 *    a failed fetch. Guessing would tell someone to reinstall software they already have. Apps get
 *    `runtime_unreachable` and should offer both paths.
 *  - `license_required` — `GET /license` is admin-only by design (it is the machine owner's state,
 *    not the app's), and licensing never gates printing. A field that could only ever say "unknown"
 *    is dead API. It returns when there is something real to report.
 */

/** What the SDK could determine about reaching the Runtime. */
export type RuntimeReachability =
  /** Nothing answered. Could be not installed, or installed and stopped — the SDK cannot tell which. */
  | 'unreachable'
  /** Answered, but speaks a protocol major this SDK doesn't. */
  | 'incompatible'
  | 'connected';

export type PairingPhase =
  /** An explicit apiKey was supplied, so pairing never applies. */
  | 'not_required'
  | 'required'
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired';

export type TargetReadiness = 'configured' | 'not_configured';

/**
 * The single value an application switches on to pick a screen. Derived from the dimensions below —
 * it never says more than they do.
 */
export type ConnectionStatus =
  | 'runtime_unreachable'
  | 'runtime_incompatible'
  | 'pairing_required'
  | 'pairing_pending'
  | 'pairing_denied'
  /** Reachable and authorized, but target readiness could not be read — so readiness is unknown, not assumed. */
  | 'connected'
  | 'target_not_configured'
  | 'ready';

/**
 * What a given Runtime build supports, so an SDK can negotiate instead of guessing from a version
 * number. A Runtime from before printer targets existed reports `printerTargets: false`, and an app
 * can fall back to `printerName` rather than failing.
 */
export interface RuntimeCapabilities {
  /** Logical print targets and per-application target configuration. */
  printerTargets: boolean;
  pairing: boolean;
  /** Exportable diagnostics bundle. Admin-only to call. */
  diagnostics: boolean;
  /**
   * The Runtime carries the license layer. It does NOT mean licensing gates anything: printing never
   * depends on it, and the license endpoint is admin-only.
   */
  licensing: boolean;
}

/** The full result of `connect()`. */
export interface ConnectionState {
  status: ConnectionStatus;
  runtime: RuntimeReachability;
  pairing: PairingPhase;
  /** Readiness of this application's targets on this machine, when they could be read. */
  targets: Partial<Record<PrintTarget, TargetReadiness>>;
  /** The Runtime's product version — what a human is shown, and what an update compares. */
  runtimeVersion?: string;
  /** The wire-contract version this Runtime speaks. */
  protocolVersion?: string;
  capabilities?: RuntimeCapabilities;
  /**
   * A sentence for a log or a support conversation. NEVER parse this — that is what `status` and the
   * dimensions are for, and the whole point of this type is that nobody has to read strings again.
   */
  detail?: string;
}
