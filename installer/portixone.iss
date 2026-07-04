; PortixOne Runtime installer.
;
; Prerequisite: run `node installer/build-staging.js` from the repo root
; first — this script packages installer/staging/, not the source tree.
;
; Requires Node.js already installed on the target machine (checked below).
; Bundling a self-contained Node runtime (e.g. via Node's Single Executable
; Applications) is a follow-up, not done here — see ROADMAP.md.
;
; Compile with Inno Setup 6 (https://jrsoftware.org/isinfo.php):
;   ISCC.exe installer\portixone.iss

#define MyAppName "PortixOne Runtime"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "PortixOne"
#define MyAppURL "https://portix.dev"
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
OutputDir=dist
OutputBaseFilename=PortixOneRuntimeSetup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayIcon={app}\tray\assets\icon.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "staging\runtime\*"; DestDir: "{app}\runtime"; Flags: recursesubdirs ignoreversion
Source: "staging\tray\*"; DestDir: "{app}\tray"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\PortixOne Tray"; Filename: "{code:GetNodePath}"; Parameters: """{app}\tray\dist\index.js"""; WorkingDir: "{app}\tray"; IconFilename: "{app}\tray\assets\icon.ico"
Name: "{userstartup}\PortixOne Tray"; Filename: "{code:GetNodePath}"; Parameters: """{app}\tray\dist\index.js"""; WorkingDir: "{app}\tray"; IconFilename: "{app}\tray\assets\icon.ico"

[Run]
Filename: "{code:GetNodePath}"; Parameters: """{app}\runtime\scripts\service.install.js"""; WorkingDir: "{app}\runtime"; StatusMsg: "Installing the PortixOne Runtime service..."; Flags: runhidden waituntilterminated
Filename: "{code:GetNodePath}"; Parameters: """{app}\tray\dist\index.js"""; WorkingDir: "{app}\tray"; Description: "Start the PortixOne tray icon now"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{code:GetNodePath}"; Parameters: """{app}\runtime\scripts\service.uninstall.js"""; WorkingDir: "{app}\runtime"; Flags: runhidden waituntilterminated; RunOnceId: "UninstallService"

[Code]
var
  NodePath: string;

function GetNodePath(Param: string): string;
begin
  Result := NodePath;
end;

function InitializeSetup(): Boolean;
begin
  if not Exec('cmd.exe', '/c where node > "' + ExpandConstant('{tmp}') + '\node-where.txt" 2>nul',
     '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    MsgBox('Node.js was not found on this machine (checked via "where node"). ' +
      'Install Node.js 20 or later from https://nodejs.org first, then run this installer again.',
      mbCriticalError, MB_OK);
    Result := False;
    exit;
  end;

  LoadStringFromFile(ExpandConstant('{tmp}') + '\node-where.txt', NodePath);
  NodePath := Trim(NodePath);
  Result := True;
end;
