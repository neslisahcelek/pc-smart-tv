Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
vbsPath = scriptDir & "\start-tv-background.vbs"
projectDir = fso.GetParentFolderName(scriptDir)

startupFolder = WshShell.SpecialFolders("Startup")
shortcutPath = startupFolder & "\SmartTVLauncher.lnk"

Set shortcut = WshShell.CreateShortcut(shortcutPath)
shortcut.TargetPath = vbsPath
shortcut.WorkingDirectory = projectDir
shortcut.Description = "Smart TV Launcher Auto-Start"
shortcut.Save

If LCase(Right(WScript.FullName, 11)) = "cscript.exe" Then
    WScript.Echo "Basarili: Smart TV Launcher Windows baslangicina eklendi."
Else
    MsgBox "Basarili! Smart TV Launcher Windows baslangicina eklendi." & vbCrLf & vbCrLf & "Bilgisayariniz her acildiginda Chrome ile TV arayuzu otomatik baslayacak.", vbInformation, "Smart TV Launcher"
End If