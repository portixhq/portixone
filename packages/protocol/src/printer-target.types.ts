/**
 * Logical print destinations.
 *
 * The point of this type: an application must never need to know the physical name of a printer on
 * someone else's Windows machine. A developer with 200 end customers cannot know that this one is
 * called "EPSON TM-T20III" and that one is "XP-80C" — so the app names the *role* it's printing to,
 * and the Runtime resolves it locally, per installation.
 *
 * Deliberately a closed set. Opening it later is additive and safe; closing an open one is not.
 */
export type PrintTarget = 'receipt' | 'kitchen' | 'bar' | 'label' | 'invoice' | 'report';

export const PRINT_TARGETS: readonly PrintTarget[] = [
  'receipt',
  'kitchen',
  'bar',
  'label',
  'invoice',
  'report',
] as const;

/** One resolved target → physical printer binding, as configured on this installation. */
export interface PrinterTargetMapping {
  /** The physical printer this target resolves to on this machine. */
  printerName: string;
  updatedAt: string;
  /**
   * True once a test print through this mapping was confirmed by a human. A mapping that was never
   * verified still prints — this records whether anyone ever saw paper come out of it.
   */
  verified: boolean;
  /**
   * Set when the bound printer stopped existing (uninstalled or renamed). The mapping is kept, not
   * deleted: silently falling back to some other printer would print a customer's receipt on the
   * wrong device, and silently deleting it would erase the only record of what to reconfigure.
   */
  invalidReason?: 'printer_missing';
}

/** Every target configured for one origin of one application. */
export type PrinterTargetsByTarget = Partial<Record<PrintTarget, PrinterTargetMapping>>;

/**
 * The Runtime's full target configuration, scoped by application and then by origin.
 *
 * Scoped by BOTH because one machine can serve several applications (a restaurant running Nerion at
 * the till and Kubia in the back office), and one application can legitimately be reached from more
 * than one origin (staging vs production). A single global `defaultPrinter` cannot express either.
 */
export interface PrinterTargetsConfig {
  applications: Record</* appId */ string, { origins: Record</* origin */ string, { targets: PrinterTargetsByTarget }> }>;
}

/** Read-only view returned by the API. */
export interface PrinterTargetsView {
  appId: string;
  origin: string;
  targets: PrinterTargetsByTarget;
}
