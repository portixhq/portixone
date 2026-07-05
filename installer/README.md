# installer

Builds `PortixOneRuntimeSetup.exe` — installs the Runtime as a Windows Service and the tray app as a Start Menu / Startup shortcut. No Electron. Node.js itself is bundled (see below) — the target machine needs nothing pre-installed.

## Build

```bash
node installer/build-staging.js
```

Assembles `installer/staging/{node,runtime,tray}` — `runtime`/`tray` are clean, production-only copies (no TypeScript source, no devDependencies, no workspace symlinks) that run standalone, and `node/node.exe` is a pinned, checksum-verified Node.js binary downloaded from `nodejs.org` (cached under `installer/.cache/` so repeat builds don't re-download). Verified: both `staging/runtime` and `staging/tray` boot correctly using only `staging/node/node.exe` and their own `node_modules`, outside the monorepo and with no system Node.js involved. `node-windows` defaults its service's `execPath` to `process.execPath`, so registering the service via the bundled `node.exe` makes the Windows Service itself run on that same bundled binary — no code changes needed in `runtime/scripts/service.install.js` for this to work.

To bump the embedded Node version, edit `EMBEDDED_NODE_VERSION` in `build-staging.js` and delete `installer/.cache/` to force a re-download.

## Portable build (no install, no admin)

```bash
node installer/build-portable.js
```

Packages the same staged `node`/`runtime`/`tray` into `installer/dist/PortixOneRuntimePortable.zip` — no Inno Setup involved, no Windows Service, no registry changes, no admin rights. Unzip anywhere and run `Start PortixOne.bat`. Verified: the bundled `node.exe` starts the runtime standalone from that folder and `GET /health` responds. Trade-off, by design: it doesn't survive a reboot or run without a logged-in user — use the full `PortixOneRuntimeSetup.exe` when that matters.

Then compile the installer with [Inno Setup 6](https://jrsoftware.org/isinfo.php):

```powershell
ISCC.exe installer\portixone.iss
```

Output: `installer\dist\PortixOneRuntimeSetup.exe`.

**Status**: compiled and verified end-to-end, both ways that matter — silently/scripted (see below) and, most importantly, the actual real-user path: double-click the `.exe`, accept the UAC prompt, click through the wizard, land on Finished with the runtime already running and the tray already up. Confirmed working by a human doing exactly that. That verification predates the embedded-Node change below — still not verified: a machine with genuinely no Node.js/dev tools installed (this should now pass, but hasn't been confirmed on real hardware), and a real Windows restart — both need a human with a second machine or a reboot they've chosen to do.

One quirk specific to *automated* invocation: running Setup.exe from a scripted/tool-driven process (rather than a normal interactive double-click) can hit `Internal error: CallSpawnServer: Unexpected response: $0` — this is an Inno Setup elevation/IPC issue tied to how the calling process is spawned, not a bug in `portixone.iss`. Confirmed by reproducing it via automation and then having a human double-click the same `.exe` normally, which worked cleanly.

## Silent / scripted installs

Always pass `/CLOSEAPPLICATIONS /FORCECLOSEAPPLICATIONS` alongside `/VERYSILENT /SUPPRESSMSGBOXES`:

```powershell
PortixOneRuntimeSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /CLOSEAPPLICATIONS /FORCECLOSEAPPLICATIONS
```

Without them, if the tray happens to be running (reinstalling/upgrading over an existing install), Inno Setup's Restart Manager shows an interactive "these applications need to close" prompt — which just hangs forever with no window to click in a silent/unattended run. An interactive (double-clicked) install still shows this dialog if the tray is running, but it's a normal one-click "Next" with "Automatically close" pre-selected — not a bug, just expected Windows Installer behavior.

## What it does

1. Copies the staged `node`, `runtime`, and `tray` folders into `Program Files\PortixOne` — no Node.js check needed since one is bundled.
2. Installs the Runtime as a Windows Service (`PortixOne Runtime`, auto-start, runs as `LocalSystem` — works without anyone logged in), using the bundled `node.exe`.
3. Adds a Start Menu shortcut and a Startup shortcut for the tray app, and launches the tray — unconditionally, not tied to the interactive Finished-page checkbox (see below for why).
4. Uninstalling kills the tray, removes the service, deletes every installed file (including what the running app generates afterwards — `.data/`, the service's log folder, `node/`), and removes both shortcuts.

## Verified (`/VERYSILENT` installs on this machine)

- Fresh install → service running, `/health` responding, tray launched, Start Menu + Startup shortcuts present.
- Reinstall over an existing install, including with the tray actively running → service kept running under the same install (not duplicated), exactly one tray process afterwards (not stacked).
- Uninstall → service gone, tray process gone, `Program Files\PortixOne` gone entirely, both shortcuts gone, `/health` unreachable.

## Bugs found by actually testing this, not by reading the script

- **Tray held file handles open during uninstall.** A first uninstall pass left `runtime`/`tray` empty folders behind because the tray was still running when file removal ran. Fixed: `kill-tray.ps1` runs first in `[UninstallRun]`.
- **Inno Setup didn't prune deeply nested empty directories on its own** (`tray\node_modules\systray2\traybin` survived, empty, after a real uninstall). Fixed: `{app}\runtime` and `{app}\tray` are entirely ours, so `[UninstallDelete]` force-removes them outright instead of relying on that.
- **Reinstalling over a running tray stacked duplicate processes** — each `[Run]` entry launch is unconditional, so without killing the old one first, a second reinstall produced two tray processes, a third produced three, etc. Fixed: `PrepareToInstall` in `[Code]` kills any existing tray before Setup does anything else.
- **The kill command matched and killed itself.** The first version of that `PrepareToInstall` fix ran an inline PowerShell filter (`Where-Object CommandLine -like '*tray*index.js*'`) — but the filter *pattern itself*, spelled out in the invoking process's own command line, matched that same process, which then killed itself mid-run and hung the elevated installer waiting on it. Fixed by calling the standalone `kill-tray.ps1` file instead (its own invocation — `-File "...\kill-tray.ps1"` — doesn't contain `index.js`, so it can't self-match).
- **`postinstall`-flagged `[Run]` entries are unreliable under `/VERYSILENT`.** That flag ties an entry to the interactive Finished-page checkbox; under `/VERYSILENT` there's no such page, and whether it still ran was inconsistent test to test. The tray launch is now a plain unconditional `[Run]` entry instead, since the product goal ("operational with no further intervention") should hold for silent/scripted deployments too.
- **The Restart Manager "files in use" prompt still isn't fully suppressed by `/SUPPRESSMSGBOXES`** — see "Silent / scripted installs" above. `/CLOSEAPPLICATIONS /FORCECLOSEAPPLICATIONS` is the actual fix; `PrepareToInstall` killing the tray early reduces how often it's needed but doesn't replace it.

## Not done yet

- Real icon / visual identity (today's tray icon is a solid-color placeholder — see `tray/scripts/generate-placeholder-icon.js`). Deliberate tech debt until PortixOne has real brand assets.
- Custom wizard imagery and Finished-page copy beyond the `FinishedLabel` override already in place — same reason, no visual assets yet.
- Code signing (unsigned installer — triggers SmartScreen warnings; `[Setup]` has a commented-out `SignTool` line ready for when a certificate exists).
- A local Dashboard (localhost) showing status/printers/queue/logs — flagged in review as a bigger follow-up, not a tray menu rename. See ROADMAP.
- Auto-update (Milestone 2.6 in the roadmap).
