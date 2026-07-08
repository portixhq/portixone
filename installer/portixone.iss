; PortixOne Runtime installer.
;
; Prerequisite: run `node installer/build-staging.js` from the repo root
; first — this script packages installer/staging/, not the source tree.
; That step also downloads a pinned, checksum-verified copy of Node.js into
; staging/node/node.exe, which this installer ships and runs from — the
; target machine needs no Node.js of its own (see ROADMAP.md Fase 4).
;
; Compile with Inno Setup 6 (https://jrsoftware.org/isinfo.php):
;   ISCC.exe installer\portixone.iss

#define MyAppName "PortixOne Runtime"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "PortixOne"
#define MyAppURL "https://portix.one"
#define ServiceDisplayName "PortixOne Runtime"

[Setup]
AppId={{9F2C6E1A-6B3D-4E7F-8A2B-PORTIXONE01}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\PortixOne
DefaultGroupName=PortixOne
DisableProgramGroupPage=yes
; Nothing on the Select Destination or Ready to Install pages is ever worth
; a stranger's attention — the install path is fixed, there's no components
; to pick. Cuts the wizard to Welcome -> Installing -> Finished, matching
; the "double-click, wait, done" goal (ROADMAP.md Fase 4).
DisableDirPage=yes
DisableReadyPage=yes
OutputDir=dist
OutputBaseFilename=PortixOneRuntimeSetup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayIcon={app}\tray\assets\icon.ico
SetupIconFile=..\tray\assets\icon.ico
VersionInfoVersion={#MyAppVersion}
VersionInfoProductName={#MyAppName}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Setup
VersionInfoCopyright=Copyright (C) 2026 {#MyAppPublisher}
; SignTool=... — no code signing certificate yet (unsigned installers trigger
; SmartScreen warnings). Uncomment and configure once one exists:
; SignTool=signtool sign /fd SHA256 /a $f

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
FinishedLabel=PortixOne Runtime is ready. Your computer can now receive print jobs from applications using PortixOne.%n%nWindows Service installed%nRuntime started%nReady to receive print jobs%n%nVersion {#MyAppVersion}
ClickFinish=

[Files]
Source: "staging\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs ignoreversion
Source: "staging\runtime\*"; DestDir: "{app}\runtime"; Flags: recursesubdirs ignoreversion
Source: "staging\tray\*"; DestDir: "{app}\tray"; Flags: recursesubdirs ignoreversion
Source: "kill-tray.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; wscript.exe + launch-hidden.vbs, not node.exe directly — a shortcut to
; node.exe can only be *minimized*, never truly hidden, so a black console
; would flash and sit in the taskbar every login. wscript.exe is a
; GUI-subsystem host: it shows no window of its own, and the vbs spawns
; node.exe with window style 0 (hidden).
Name: "{group}\PortixOne Tray"; Filename: "wscript.exe"; Parameters: """{app}\tray\launch-hidden.vbs"""; WorkingDir: "{app}\tray"; IconFilename: "{app}\tray\assets\icon.ico"
Name: "{userstartup}\PortixOne Tray"; Filename: "wscript.exe"; Parameters: """{app}\tray\launch-hidden.vbs"""; WorkingDir: "{app}\tray"; IconFilename: "{app}\tray\assets\icon.ico"

[Run]
Filename: "{code:GetNodePath}"; Parameters: """{app}\runtime\scripts\service.install.js"""; WorkingDir: "{app}\runtime"; StatusMsg: "Installing the PortixOne Runtime service..."; Flags: runhidden waituntilterminated
; (Any previous tray instance is already killed in PrepareToInstall, above —
; before Setup even gets here — so this always launches exactly one.)
; Deliberately NOT using the `postinstall` flag: that ties this to the
; interactive Finished-page checkbox, which doesn't exist under
; /VERYSILENT — tested repeatedly, and the tray never launched that way.
; The product goal is "operational with no further intervention" even for
; a silent/scripted deployment, so this is just an unconditional step.
Filename: "wscript.exe"; Parameters: """{app}\tray\launch-hidden.vbs"""; WorkingDir: "{app}\tray"; Flags: nowait

[UninstallRun]
; Order matters: kill the tray first so it isn't holding file handles open
; when uninstall gets to removing {app}\tray (found the hard way — a first
; test left runtime/tray folders behind because the tray was still running).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\kill-tray.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "KillTray"
Filename: "{code:GetNodePath}"; Parameters: """{app}\runtime\scripts\service.uninstall.js"""; WorkingDir: "{app}\runtime"; Flags: runhidden waituntilterminated; RunOnceId: "UninstallService"

[UninstallDelete]
; Files the runtime/service create after install (config, logs, the
; node-windows daemon wrapper) — Inno Setup only auto-removes what it
; installed, not what the app generated afterwards.
Type: filesandordirs; Name: "{app}\runtime\.data"
Type: filesandordirs; Name: "{app}\runtime\scripts\daemon"
; Belt-and-suspenders: confirmed by testing that Inno Setup's own file
; tracking doesn't reliably prune deeply nested now-empty directory
; chains (found tray\node_modules\systray2\traybin left behind, empty,
; after a real uninstall run) — {app}\runtime and {app}\tray are 100%
; ours, so force them gone rather than trying to enumerate every nested
; empty dir individually.
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\tray"
Type: filesandordirs; Name: "{app}\node"
Type: dirifempty; Name: "{app}"

[Code]
function GetNodePath(Param: string): string;
begin
  // Bundled under {app}\node by build-staging.js — no system Node.js
  // required (see ROADMAP.md Fase 4). [Files] copies it before [Icons]/
  // [Run] ever reference this path, so it's always present by then.
  Result := ExpandConstant('{app}') + '\node\node.exe';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  KillScript: String;
begin
  // Reinstalling/upgrading over a running tray otherwise trips Inno Setup's
  // own Restart Manager "files in use" prompt (found by testing a real
  // reinstall while the tray was open) — kill it here, before Setup checks
  // for locked files, instead of relying on [Run] (which only executes
  // after that check already happened) or the interactive prompt.
  //
  // Calls the already-installed kill-tray.ps1 (present from any prior
  // install — this only matters on a reinstall, since a first-ever install
  // has no tray running yet) rather than inlining the same filter here:
  // an earlier version embedded the search pattern directly in this
  // process's own -Command string, which made it match and kill *itself*
  // mid-execution — found the hard way when repeated installs hung.
  KillScript := ExpandConstant('{app}') + '\kill-tray.ps1';
  if FileExists(KillScript) then
    Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + KillScript + '"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
  NeedsRestart := False;
end;
