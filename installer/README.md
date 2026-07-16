# installer

Builds `PortixOne-<version>.exe` — installs the Runtime as a Windows Service and the tray app as a Start Menu / Startup shortcut. No Electron. Node.js itself is bundled (see below) — the target machine needs nothing pre-installed.

## Build

```bash
npm run build          # from the repo root — see below for why this comes first
node installer/build-staging.js
```

The root `npm run build` matters here for two reasons, not just compiling `runtime`/`tray`: its `prebuild` hook (`scripts/sync-version.js`) generates `installer/version.iss` (`#include`d by `portixone.iss` for `MyAppVersion`) and syncs `packages/shared`'s `APP_VERSION` — both from the root `package.json`'s `"version"`, the single source of truth. Skipping it leaves `version.iss` stale or (on a fresh clone) missing entirely, which fails the Inno Setup compile below.

`build-staging.js` assembles `installer/staging/{node,runtime,tray}` — `runtime`/`tray` are clean, production-only copies (no TypeScript source, no devDependencies, no workspace symlinks) that run standalone, and `node/node.exe` is a pinned, checksum-verified Node.js binary downloaded from `nodejs.org` (cached under `installer/.cache/` so repeat builds don't re-download). Verified: both `staging/runtime` and `staging/tray` boot correctly using only `staging/node/node.exe` and their own `node_modules`, outside the monorepo and with no system Node.js involved. `node-windows` defaults its service's `execPath` to `process.execPath`, so registering the service via the bundled `node.exe` makes the Windows Service itself run on that same bundled binary — no code changes needed in `runtime/scripts/service.install.js` for this to work.

To bump the embedded Node version, edit `EMBEDDED_NODE_VERSION` in `build-staging.js` and delete `installer/.cache/` to force a re-download.

## Portable build (no install, no admin)

```bash
node installer/build-portable.js
```

Packages the same staged `node`/`runtime`/`tray` into `installer/dist/PortixOneRuntimePortable.zip` — no Inno Setup involved, no Windows Service, no registry changes, no admin rights. Unzip anywhere and run `Start PortixOne.bat`. Verified: the bundled `node.exe` starts the runtime standalone from that folder and `GET /health` responds. Trade-off, by design: it doesn't survive a reboot or run without a logged-in user — use the full `PortixOne-<version>.exe` installer when that matters.

Then compile the installer with [Inno Setup 6](https://jrsoftware.org/isinfo.php):

```powershell
ISCC.exe installer\portixone.iss
```

Output: `installer\dist\PortixOne-<version>.exe`.

**Status**: compiled and verified end-to-end, both ways that matter — silently/scripted (see below) and, most importantly, the actual real-user path: double-click the `.exe`, accept the UAC prompt, click through the wizard, land on Finished with the runtime already running and the tray already up. Confirmed working by a human doing exactly that. That verification predates the embedded-Node change below — still not verified: a machine with genuinely no Node.js/dev tools installed (this should now pass, but hasn't been confirmed on real hardware), and a real Windows restart — both need a human with a second machine or a reboot they've chosen to do.

One quirk specific to *automated* invocation: running Setup.exe from a scripted/tool-driven process (rather than a normal interactive double-click) can hit `Internal error: CallSpawnServer: Unexpected response: $0` — this is an Inno Setup elevation/IPC issue tied to how the calling process is spawned, not a bug in `portixone.iss`. Confirmed by reproducing it via automation and then having a human double-click the same `.exe` normally, which worked cleanly.

## Silent / scripted installs

Always pass `/CLOSEAPPLICATIONS /FORCECLOSEAPPLICATIONS` alongside `/VERYSILENT /SUPPRESSMSGBOXES`:

```powershell
PortixOne-<version>.exe /VERYSILENT /SUPPRESSMSGBOXES /CLOSEAPPLICATIONS /FORCECLOSEAPPLICATIONS
```

Without them, if the tray happens to be running (reinstalling/upgrading over an existing install), Inno Setup's Restart Manager shows an interactive "these applications need to close" prompt — which just hangs forever with no window to click in a silent/unattended run. An interactive (double-clicked) install still shows this dialog if the tray is running, but it's a normal one-click "Next" with "Automatically close" pre-selected — not a bug, just expected Windows Installer behavior.

## What it does

1. Copies the staged `node`, `runtime`, and `tray` folders into `Program Files\PortixOne` — no Node.js check needed since one is bundled.
2. Installs the Runtime as a Windows Service (`PortixOne Runtime`, auto-start, runs as `LocalSystem` — works without anyone logged in), using the bundled `node.exe`. Service recovery is configured at two layers: node-windows' own wrapper restarts the Node process on a crash, and `sc failure`/`sc failureflag` (`runtime/scripts/service.install.js`) additionally restart the Windows Service itself if that wrapper process is the one that dies.
3. Adds a Windows Firewall rule (`runtime/scripts/firewall.install.js`) for the Runtime's port — read from `@portixone/shared`'s `DEFAULT_RUNTIME_PORT`, not hardcoded — scoped to Private/Domain network profiles.
4. Adds a Start Menu shortcut and a Startup shortcut for the tray app, and launches the tray — unconditionally, not tied to the interactive Finished-page checkbox (see below for why).
5. Uninstalling kills the tray, removes the service, removes the firewall rule, deletes every installed file (including what the running app generates afterwards — `.data/`, the service's log folder, `node/`), and removes both shortcuts.

## Release

```bash
node installer/release.js
```

Run after the artifacts above already exist in `installer/dist/` (the compiled `.exe` and/or the portable `.zip`) — this doesn't build anything, it publishes alongside them: `SHA256SUMS.txt` (one line per artifact, standard `<hash>  <filename>` format) and `RELEASE_NOTES.md` (the topmost dated section of the root `CHANGELOG.md`, since that changelog is organized by milestone/date rather than by a per-version heading).

### Publishing a Runtime release — the rules the updater depends on

This repo publishes releases for several products from one feed: the Runtime installer, and npm
package tags (`sdk-v0.3.4`, `protocol-v0.2.2`, …). The tray's updater (`tray/src/updater.ts`)
therefore selects releases by the Runtime's own tag convention and **never** consults
`/releases/latest`. Break these rules and installed trays silently stop seeing updates.

**1. Tag convention — the channel lives in the tag.**

| Tag | Channel | Who gets it |
|---|---|---|
| `runtime-v0.1.1` | `stable` | everyone |
| `runtime-v0.2.0-beta.1` | `beta` | beta + internal machines |
| `runtime-v0.1.1-internal.1` | `internal` | internal machines only |

A plain tag (no suffix) that is **flagged as a GitHub pre-release** is treated as `internal`, never
as stable — so a pilot published under a plain tag can't be pushed to everyone by accident.
Channels are inclusive downward: an internal machine still takes a newer stable.

A machine's channel comes from `PORTIX_UPDATE_CHANNEL` (`stable` unless explicitly opted in).

**2. Every Runtime release MUST carry both assets:**

- `PortixOne-Setup.exe` — the version-less filename is deliberate; `portix.one/download` redirects
  to it, so renaming it breaks the download CTA.
- `SHA256SUMS.txt` — the tray refuses to run an installer it cannot verify, so a release without
  checksums is skipped entirely. An unverifiable installer is worse than no update.

**3. The version in the tag must match the artifact.** The `.exe` reports the root `package.json`
version (via `scripts/sync-version.js` → `version.iss` + `APP_VERSION`). Tag `runtime-v0.1.1` must
be built from a tree whose version is `0.1.1`, or a machine will "update" and still report the old
version — and then re-offer the same update forever.

**4. Never publish a Runtime release without the `runtime-` prefix.** `v0.1.1` or `0.1.1` are
invisible to every installed tray.

```bash
gh release create runtime-v0.1.1 \
  --title "PortixOne Runtime 0.1.1" \
  --notes-file installer/dist/RELEASE_NOTES.md \
  --target master \
  installer/dist/PortixOne-Setup.exe \
  installer/dist/PortixOneRuntimePortable.zip \
  installer/dist/SHA256SUMS.txt
# add --prerelease for an internal/pilot build
```

**Intended end state:** a product-owned signed manifest at
`https://releases.portix.one/runtime/<channel>.json`, so update discovery doesn't depend on GitHub's
release feed at all. The GitHub filtering above is the transitional implementation; swapping it
touches only `fetchReleases()` in the updater.

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

- Custom wizard imagery beyond the `FinishedLabel` text override already in place and the real tray/setup icon (`tray/assets/favicon.svg`) — no wizard-specific visual assets yet, deliberate tech debt until Fase 7 branding exists.
- Code signing (unsigned installer — triggers SmartScreen warnings; `[Setup]` has a commented-out `SignTool` line ready for when a certificate exists). Deliberately deferred — see ROADMAP.md Fase 4.
- An MSI build alongside the `.exe`/portable `.zip` formats above.
- A real end-to-end install verified on a machine with genuinely no Node.js/dev tools, and a real Windows restart — both need a spare machine or working VM, not more code (ROADMAP.md Fase 4).
