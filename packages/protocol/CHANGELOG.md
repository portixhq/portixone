# @portixone/protocol

## 0.2.1

- Added `preview?: string` to `PrintJobResult` — the rendered text preview, present only when a job ran in the SDK's mock mode. Additive, no wire changes for real runtime prints.

## 0.2.0

**Breaking wire change**, pre-1.0: `JobStatus` values changed shape from `'queued' | 'printed' | 'error'` to `'pending' | 'printing' | 'completed' | 'failed' | 'cancelled'` to match the persisted-queue lifecycle built in Milestone 3. `PROTOCOL_VERSION` was bumped in code to `0.2.0` alongside this change; this release syncs the published package version to match.

- Added `JobOwner` and `JobRecord` types — a job's full record as tracked by the queue, returned by the SDK's `getJobs()`.
- Added `PrinterInfo` — a printer as reported by discovery, returned by `listPrinters()`/`getPrinter()`.
- Added `pairing.types.ts` and `pairing.schema.ts` — the pairing request/status contract used by `Portix.pair()`.
- Added `metrics.types.ts` — the `GET /metrics` response contract (`RuntimeMetrics`), used by `Portix.getMetrics()`.
- Added `WS_EVENTS.JOB_PRINTING` and `WS_EVENTS.JOB_CANCELLED` to reflect the fuller job lifecycle.

## 0.1.0

- Initial release: `PrintJob`, `PrintJobResult`, `RuntimeStatus`, `Capability`, `PROTOCOL_VERSION`, `API_KEY_HEADER`, base `WS_EVENTS`.
