export type PrinterDriverType = 'mock' | 'network' | 'windows-spooler';

export interface RuntimeConfig {
  port: number;
  host: string;
  apiKey: string;
  defaultPrinter?: string;
  printerDriver: PrinterDriverType;
  networkPrinterHost?: string;
  networkPrinterPort: number;
  /**
   * Licensing (plan §4). All optional — an unconfigured runtime is a developer's machine and
   * runs unlicensed/development, which prints freely. These only come into play once a runtime is
   * deployed under a registered Application.
   */
  /** The public Application ID (`app_<slug>_<rand>`) this runtime is deployed under, if any. */
  applicationId?: string;
  /** portix-cloud's token-renewal endpoint. Unset = heartbeat inert, runtime rides cached token. */
  licenseHeartbeatUrl?: string;
  /** portix-cloud's installation-registration endpoint. Unset = installation-token exchange skipped. */
  licenseRegistrationUrl?: string;
  /** One-time installation token (plan §9), written into config by the installer. Consumed once at boot. */
  installationToken?: string;
}
