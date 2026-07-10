# Launches the PortixOne Tray with no visible console window.
#
# Windows shortcuts (.lnk) can only minimize a console app, not hide it — the
# underlying node.exe still flashes/appears in the taskbar as a black window
# a user can restore. Start-Process -WindowStyle Hidden is the actual way to
# suppress it.
#
# TECH DEBT — temporary measure, not the final architecture (2026-07-10):
# this replaces the previous wscript.exe + launch-hidden.vbs approach after
# a genuinely clean-machine install test (Windows Sandbox, build 10.0.26200)
# hit "There is no script engine for file extension '.vbs'" — Windows
# Script Host had no registered VBScript engine at all, for any caller.
# Microsoft has been actively deprecating VBScript, so this could affect
# real customers on a current Windows build, not just this one test
# environment. PowerShell ships with Windows and isn't deprecated, making it
# the smallest, most stable stopgap available today — but it is still a
# console-subsystem host (unlike wscript.exe, which is GUI-subsystem and
# never shows a window at all), so `-WindowStyle Hidden` on the *outer*
# powershell.exe invocation (see portixone.iss) can still show a brief
# flash on some systems. The real fix is for the tray to stop depending on
# node.exe entirely and ship as its own compiled executable — Windows can
# then start that directly, no hidden-console-host trick needed at all. Once
# that exists, delete this script outright rather than replacing it with
# something else.
#
# Paths are resolved relative to this script's own location rather than
# hardcoded, so the same file works unmodified from installer/staging/tray,
# the portable zip's tray/ folder, and the installed {app}\tray\ — all three
# share the same "tray/ next to node/" sibling layout.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = Join-Path $scriptDir '..\node\node.exe'
$trayScript = Join-Path $scriptDir 'dist\index.js'

Start-Process -FilePath $nodeExe -ArgumentList "`"$trayScript`"" -WindowStyle Hidden
