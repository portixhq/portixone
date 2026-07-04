# installer

Builds `PortixOneRuntimeSetup.exe` — installs the Runtime as a Windows Service and the tray app as a Start Menu / Startup shortcut. No Electron, no bundled Node runtime (yet) — the target machine needs Node.js 20+ already installed.

## Build

```bash
node installer/build-staging.js
```

Assembles `installer/staging/{runtime,tray}` — each a clean, production-only copy (no TypeScript source, no devDependencies, no workspace symlinks) that runs standalone. Verified: both `staging/runtime` and `staging/tray` boot correctly with only their own `node_modules`, outside the monorepo.

Then compile the installer with [Inno Setup 6](https://jrsoftware.org/isinfo.php):

```powershell
ISCC.exe installer\portixone.iss
```

Output: `installer\dist\PortixOneRuntimeSetup.exe`.

**Status**: `portixone.iss` is written but not yet compiled/tested on this machine — Inno Setup isn't installed here. Needs a real compile-and-run pass before this is verified end-to-end.

## What it does

1. Checks for Node.js on the target machine (fails with a clear message + link to nodejs.org if missing).
2. Copies the staged runtime + tray into `Program Files\PortixOne`.
3. Installs the Runtime as a Windows Service (`PortixOne Runtime`, auto-start, runs as `LocalSystem` — works without anyone logged in).
4. Adds a Start Menu shortcut and a Startup shortcut for the tray app.
5. Uninstalling removes the service and the installed files.

## Not done yet

- Bundling a self-contained Node runtime (Node SEA or similar), so Node.js isn't a prerequisite.
- Auto-update (Milestone 2.4 in the roadmap).
- Code signing (unsigned installers trigger SmartScreen warnings).
