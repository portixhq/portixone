# @portixone/shared

## 0.2.0

- Added a full set of hardware-specific error classes to `domain.errors.ts`: `PairingNotFoundError`, `UntrustedOriginError`, `PermissionDeniedError`, `JobNotCancellableError`, `InvalidRequestError`, `PrinterOfflineError`, `PaperOutError`, `PrinterConnectionLostError`, `PrinterTimeoutError`, `PrinterBusyError`, `PrinterNotReadyError`, `InvalidDriverConfigError` — each carries a human-readable message and a stable error code.
- Added `APP_VERSION` to `shared.constants.ts` — the installed product version, kept in sync by hand with `installer/portixone.iss`'s `MyAppVersion`.

## 0.1.0

- Initial release: `DEFAULT_RUNTIME_PORT`, `DEFAULT_RUNTIME_HOST`, `DEFAULT_CONFIG_FILENAME`, `DEFAULT_NETWORK_PRINTER_PORT`, and the base `PortixError` / `PrinterConnectionError` classes.
