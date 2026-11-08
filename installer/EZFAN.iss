; Installateur EZFAN (Inno Setup 6).
; EZFAN pilote les ventilateurs et demande toujours les droits administrateur :
; il s'installe donc pour tout le PC, dans Program Files.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\publish"
#endif

[Setup]
AppId={{4F6C2B1E-8A3D-4E7B-9C51-2D7E0F3A9B64}
AppName=EZFAN
AppVersion={#AppVersion}
AppPublisher=Florian
AppPublisherURL=https://github.com/Snooze561/EZFAN
DefaultDirName={autopf}\EZFAN
DefaultGroupName=EZFAN
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputDir=..\out
OutputBaseFilename=EZFAN-Setup-{#AppVersion}
UninstallDisplayIcon={app}\EZFAN.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Ferme EZFAN proprement avant une mise à jour : il rend alors les ventilateurs au BIOS.
CloseApplications=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Files]
Source: "{#SourceDir}\EZFAN.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\wwwroot\*"; DestDir: "{app}\wwwroot"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\EZFAN"; Filename: "{app}\EZFAN.exe"

[Run]
; shellexec : EZFAN demande les droits administrateur au lancement.
Filename: "{app}\EZFAN.exe"; Description: "Lancer EZFAN maintenant"; Flags: nowait postinstall skipifsilent shellexec

[UninstallRun]
; Le lancement avec Windows d'EZFAN est une tâche planifiée : on la retire.
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN EZFAN /F"; Flags: runhidden; RunOnceId: "RemoveTask"

[UninstallDelete]
Type: files; Name: "{app}\rapport-materiel.txt"
