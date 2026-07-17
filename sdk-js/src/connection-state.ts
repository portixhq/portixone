import { PROTOCOL_VERSION } from '@portixone/protocol';
import type {
  ConnectionState,
  ConnectionStatus,
  PairingPhase,
  PrintTarget,
  RuntimeReachability,
  TargetReadiness,
} from './types.js';

/**
 * Turns everything observed about a Runtime into one state an application can switch on.
 *
 * Pure on purpose: every state is reachable in a test without a network, a Runtime, or a printer,
 * which is the only way "Nerion can render a correct screen for each state" is verifiable rather
 * than asserted.
 */

export interface ObservedConnection {
  runtime: RuntimeReachability;
  pairing: PairingPhase;
  /** Undefined when targets could not be read — which is NOT the same as "none configured". */
  targets?: Partial<Record<PrintTarget, TargetReadiness>>;
  /** The target this call needs, if the caller named one. */
  expectedTarget?: PrintTarget;
  runtimeVersion?: string;
  protocolVersion?: string;
  detail?: string;
}

/** Major-version compatibility: a protocol major bump is what breaks the wire contract, not a minor. */
export function isProtocolCompatible(remote: string | undefined, local: string = PROTOCOL_VERSION): boolean {
  if (!remote) {
    // A Runtime old enough not to report a protocol version predates this check. Assume compatible
    // rather than locking out every install that came before it; a real mismatch surfaces as a
    // request failing, not as a version string.
    return true;
  }
  return remote.split('.')[0] === local.split('.')[0];
}

/**
 * The precedence is deliberate and reads top to bottom: you cannot pair with a Runtime you cannot
 * reach, and a target cannot be judged before you are authorized to ask about it. Each state is only
 * ever reported once everything before it is settled.
 */
export function deriveStatus(observed: ObservedConnection): ConnectionStatus {
  if (observed.runtime === 'unreachable') {
    return 'runtime_unreachable';
  }
  if (observed.runtime === 'incompatible') {
    return 'runtime_incompatible';
  }
  switch (observed.pairing) {
    case 'required':
      return 'pairing_required';
    case 'pending':
      return 'pairing_pending';
    case 'denied':
    case 'expired':
      return 'pairing_denied';
    default:
      break;
  }
  // Authorized from here on.
  if (!observed.targets) {
    // Reachable and authorized, but we could not read targets — say so instead of implying ready.
    return 'connected';
  }
  if (observed.expectedTarget) {
    return observed.targets[observed.expectedTarget] === 'configured' ? 'ready' : 'target_not_configured';
  }
  return 'ready';
}

export function buildConnectionState(observed: ObservedConnection): ConnectionState {
  return {
    status: deriveStatus(observed),
    runtime: observed.runtime,
    pairing: observed.pairing,
    targets: observed.targets ?? {},
    runtimeVersion: observed.runtimeVersion,
    protocolVersion: observed.protocolVersion,
    detail: observed.detail,
  };
}
