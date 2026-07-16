import type {
  PrinterTargetMapping,
  PrinterTargetsByTarget,
  PrinterTargetsView,
  PrintTarget,
} from '@portixone/protocol';
import { MappingInvalidError, TargetNotConfiguredError } from '@portixone/shared';
import { PrinterTargetsStore } from './printer-targets.store.js';

/**
 * Origins are part of the scope key, but not every caller has one: a browser always sends `Origin`,
 * a CLI or server-side integration never does. Those callers share this bucket rather than being
 * unable to configure targets at all.
 */
export const NO_ORIGIN = '*';

export interface TargetScope {
  appId: string;
  origin?: string;
}

/**
 * Resolves logical targets to physical printers, per application and origin.
 *
 * This is the layer that lets a developer write `print({ target: 'receipt' })` once and ship it to
 * every customer: the name of the actual printer is installation-local state, configured by whoever
 * runs that machine, and never travels through the application's code.
 */
export class PrinterTargetsService {
  constructor(
    private readonly store = new PrinterTargetsStore(),
    /** Legacy bridge: the single global printer configured before targets existed. */
    private readonly legacyDefaultPrinter?: string,
  ) {}

  private static originKey(origin?: string): string {
    return origin ?? NO_ORIGIN;
  }

  list(appId: string, origin?: string): PrinterTargetsView {
    const config = this.store.read();
    const key = PrinterTargetsService.originKey(origin);
    return {
      appId,
      origin: key,
      targets: config.applications[appId]?.origins[key]?.targets ?? {},
    };
  }

  /** Every application/origin configured on this machine — the admin/dashboard view. */
  listAll(): PrinterTargetsView[] {
    const config = this.store.read();
    const views: PrinterTargetsView[] = [];
    for (const [appId, app] of Object.entries(config.applications)) {
      for (const [origin, entry] of Object.entries(app.origins)) {
        views.push({ appId, origin, targets: entry.targets });
      }
    }
    return views;
  }

  set(scope: TargetScope, target: PrintTarget, printerName: string, verified = false): PrinterTargetMapping {
    const config = this.store.read();
    const key = PrinterTargetsService.originKey(scope.origin);
    const app = (config.applications[scope.appId] ??= { origins: {} });
    const entry = (app.origins[key] ??= { targets: {} });
    const mapping: PrinterTargetMapping = {
      printerName,
      updatedAt: new Date().toISOString(),
      verified,
    };
    entry.targets[target] = mapping;
    this.store.write(config);
    return mapping;
  }

  /** Marks a mapping as confirmed by a human who saw the test print come out. */
  markVerified(scope: TargetScope, target: PrintTarget): PrinterTargetMapping | undefined {
    const config = this.store.read();
    const key = PrinterTargetsService.originKey(scope.origin);
    const mapping = config.applications[scope.appId]?.origins[key]?.targets[target];
    if (!mapping) {
      return undefined;
    }
    mapping.verified = true;
    mapping.updatedAt = new Date().toISOString();
    this.store.write(config);
    return mapping;
  }

  remove(scope: TargetScope, target: PrintTarget): boolean {
    const config = this.store.read();
    const key = PrinterTargetsService.originKey(scope.origin);
    const targets = config.applications[scope.appId]?.origins[key]?.targets;
    if (!targets?.[target]) {
      return false;
    }
    delete targets[target];
    this.store.write(config);
    return true;
  }

  /**
   * Resolves a target to the printer it should print on.
   *
   * `installedPrinters` is passed in (rather than discovered here) so resolution stays synchronous
   * and testable, and so the caller decides how fresh the printer list needs to be. Pass undefined
   * to skip the existence check — e.g. when discovery itself is unavailable and we'd rather attempt
   * the print than refuse it.
   *
   * Throws rather than falling back to "some other printer": printing a customer's receipt on the
   * wrong device is worse than a clear error telling them to reconfigure.
   */
  resolve(scope: TargetScope, target: PrintTarget, installedPrinters?: string[]): string {
    const mapping = this.list(scope.appId, scope.origin).targets[target];

    if (!mapping) {
      // Legacy bridge: before targets existed there was one global defaultPrinter. Honor it for
      // `receipt` so integrations written against the old contract keep working after an update,
      // instead of every existing install breaking the moment targets shipped.
      if (target === 'receipt' && this.legacyDefaultPrinter) {
        return this.legacyDefaultPrinter;
      }
      throw new TargetNotConfiguredError(target);
    }

    if (installedPrinters && !installedPrinters.includes(mapping.printerName)) {
      this.markInvalid(scope, target);
      throw new MappingInvalidError(target, mapping.printerName);
    }

    return mapping.printerName;
  }

  /** Flags a mapping whose printer disappeared. Kept, never deleted — it's the record of what to fix. */
  private markInvalid(scope: TargetScope, target: PrintTarget): void {
    const config = this.store.read();
    const key = PrinterTargetsService.originKey(scope.origin);
    const mapping = config.applications[scope.appId]?.origins[key]?.targets[target];
    if (mapping && mapping.invalidReason !== 'printer_missing') {
      mapping.invalidReason = 'printer_missing';
      this.store.write(config);
    }
  }

  /**
   * Re-checks every mapping against the printers actually installed, flagging any whose printer is
   * gone and clearing the flag on any that came back (a printer can return after a driver reinstall).
   * Returns the targets whose validity changed.
   */
  revalidate(installedPrinters: string[]): { appId: string; origin: string; target: PrintTarget; valid: boolean }[] {
    const config = this.store.read();
    const changed: { appId: string; origin: string; target: PrintTarget; valid: boolean }[] = [];
    let dirty = false;

    for (const [appId, app] of Object.entries(config.applications)) {
      for (const [origin, entry] of Object.entries(app.origins)) {
        for (const [target, mapping] of Object.entries(entry.targets) as [PrintTarget, PrinterTargetMapping][]) {
          const exists = installedPrinters.includes(mapping.printerName);
          const wasInvalid = mapping.invalidReason === 'printer_missing';
          if (!exists && !wasInvalid) {
            mapping.invalidReason = 'printer_missing';
            changed.push({ appId, origin, target, valid: false });
            dirty = true;
          } else if (exists && wasInvalid) {
            delete mapping.invalidReason;
            changed.push({ appId, origin, target, valid: true });
            dirty = true;
          }
        }
      }
    }

    if (dirty) {
      this.store.write(config);
    }
    return changed;
  }
}

export type { PrinterTargetsByTarget };
