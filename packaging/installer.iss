; RetailTec Analytics — Inno Setup installer
; ==========================================
; Wraps the PyInstaller onedir output (packaging\out\RetailTecAnalytics) into a
; single one-click Windows installer with Start-menu + optional desktop shortcut,
; optional start-on-login, and a clean uninstaller.
;
; Build order:
;   1. Run packaging\build.ps1  (produces packaging\out\RetailTecAnalytics\)
;   2. Compile this script with Inno Setup 6 (ISCC.exe installer.iss) — build.ps1
;      does this automatically when Inno Setup is installed.
;
; Output: packaging\Output\RetailTecAnalytics-Setup.exe
;
; NOTE: the app needs Oracle Instant Client on the customer machine
; (C:\Oracle\instantclient). It cannot be redistributed inside this installer.

#define AppName    "RetailTec Analytics"
#define AppVersion "2.0.0"
#define AppExe     "RetailTecAnalytics.exe"
#define Publisher  "RetailTec"

[Setup]
AppId={{A3F1C2D4-9E8B-4C7A-B2E1-6D5F4A3B2C1D}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#Publisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=RetailTecAnalytics-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
UninstallDisplayIcon={app}\{#AppExe}
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"
Name: "autostart";   Description: "Start {#AppName} automatically when I sign in"; GroupDescription: "Startup:"; Flags: unchecked

[Files]
; The entire PyInstaller onedir output (exe + _internal + bundled web app).
; Excludes: runtime state that must NEVER ship to customers — connection
; settings (DPAPI secrets), JWT secret, synced warehouses, logs, backups.
Source: "out\RetailTecAnalytics\*"; DestDir: "{app}"; Excludes: "settings.json,.jwt_secret,retailtec_*.db,retailtec_*.db.wal,retailtec.log,\_internal\backups\*"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}";             Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall {#AppName}";   Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}";       Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; Optional start-on-login (per-user Run key). Removed on uninstall.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "RetailTecAnalytics"; ValueData: """{app}\{#AppExe}"""; \
  Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName} now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up runtime files created next to the exe (logs, jwt secret, backups stay
; unless the user removes them). The warehouse .db is intentionally left in place.
Type: files; Name: "{app}\retailtec.log"
