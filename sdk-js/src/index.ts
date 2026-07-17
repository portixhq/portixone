export { Portix } from './portix.js';
export { RuntimeUnreachableError } from './client.adapter.js';
export { PortixSetup, deriveSetupStep } from './setup.js';
export type { SetupState, SetupStep, SetupEvent, SetupEventHandler, SetupDriver } from './setup.js';
export type {
  PortixOptions,
  PortixClientOptions,
  PortixEvent,
  PortixEventHandler,
  ConnectOptions,
  ConnectionState,
  ConnectionStatus,
  RuntimeReachability,
  PairingPhase,
  TargetReadiness,
  RuntimeCapabilities,
  PrintOptions,
  PrintResult,
  PrintTarget,
  PrinterTargetsView,
  PrinterTargetMapping,
  RuntimeStatusResult,
  PrinterInfo,
  JobRecord,
  JobOwner,
  PairingRequestResult,
  PairingStatusResult,
  RuntimeMetrics,
} from './types.js';
export { PRINT_TARGETS } from './types.js';
