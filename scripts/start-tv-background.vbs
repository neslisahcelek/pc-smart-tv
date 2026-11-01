Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get project directory (parent of scripts folder)
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)

' Change working directory to project root
WshShell.CurrentDirectory = projectDir

' Locate node.exe
nodeExe = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
    nodeExe = """C:\Program Files\nodejs\node.exe"""
ElseIf fso.FileExists("C:\Program Files (x86)\nodejs\node.exe") Then
    nodeExe = """C:\Program Files (x86)\nodejs\node.exe"""
End If

serverScript = """" & projectDir & "\dist\server\server\index.js"""

' Check if server is already running on port 3000
serverAlreadyRunning = False
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.open "GET", "http://127.0.0.1:3000/api/health", False
http.send
If Err.Number = 0 Then
    If http.status = 200 Then
        serverAlreadyRunning = True
    End If
End If
Set http = Nothing
On Error Goto 0

' Start Node server silently in background if not already running
If Not serverAlreadyRunning Then
    WshShell.Run nodeExe & " " & serverScript, 0, False

    ' Wait actively for server to respond (up to 30 seconds)
    For i = 1 To 60
        On Error Resume Next
        Set http = CreateObject("MSXML2.XMLHTTP")
        http.open "GET", "http://127.0.0.1:3000/api/health", False
        http.send
        If Err.Number = 0 Then
            If http.status = 200 Then
                Set http = Nothing
                On Error Goto 0
                Exit For
            End If
        End If
        Set http = Nothing
        On Error Goto 0
        WScript.Sleep 500
    Next
End If

' Optional: Launch Antigravity only if explicitly requested via environment variable or .env file (default: off)
launchAntigravity = False
launchAntigravityEnv = LCase(WshShell.ExpandEnvironmentStrings("%LAUNCH_ANTIGRAVITY%"))
If launchAntigravityEnv = "1" Or launchAntigravityEnv = "true" Or LCase(WshShell.ExpandEnvironmentStrings("%SMART_TV_LAUNCH_ANTIGRAVITY%")) = "1" Then
    launchAntigravity = True
ElseIf fso.FileExists(projectDir & "\.env") Then
    On Error Resume Next
    Set envFile = fso.OpenTextFile(projectDir & "\.env", 1)
    If Err.Number = 0 Then
        Do Until envFile.AtEndOfStream
            envLine = Trim(envFile.ReadLine)
            If InStr(1, envLine, "LAUNCH_ANTIGRAVITY=true", vbTextCompare) > 0 Or InStr(1, envLine, "LAUNCH_ANTIGRAVITY=1", vbTextCompare) > 0 Then
                launchAntigravity = True
                Exit Do
            End If
        Loop
        envFile.Close
    End If
    Set envFile = Nothing
    On Error Goto 0
End If

If launchAntigravity Then
    antigravityRunning = False
    On Error Resume Next
    Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")
    Set colProcesses = objWMIService.ExecQuery("Select Name from Win32_Process Where Name = 'Antigravity.exe'")
    If colProcesses.Count > 0 Then
        antigravityRunning = True
    End If
    On Error Goto 0

    If Not antigravityRunning Then
        antigravityPath = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Antigravity\Antigravity.exe"
        If fso.FileExists(antigravityPath) Then
            WshShell.Run """" & antigravityPath & """", 1, False
        ElseIf fso.FileExists("C:\Program Files\Antigravity\Antigravity.exe") Then
            WshShell.Run """C:\Program Files\Antigravity\Antigravity.exe""", 1, False
        ElseIf fso.FileExists("C:\Program Files (x86)\Antigravity\Antigravity.exe") Then
            WshShell.Run """C:\Program Files (x86)\Antigravity\Antigravity.exe""", 1, False
        End If
        WScript.Sleep 600
    End If
End If

' Locate Google Chrome
chromePath = ""
If fso.FileExists("C:\Program Files\Google\Chrome\Application\chrome.exe") Then
    chromePath = """C:\Program Files\Google\Chrome\Application\chrome.exe"""
ElseIf fso.FileExists("C:\Program Files (x86)\Google\Chrome\Application\chrome.exe") Then
    chromePath = """C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"""
ElseIf fso.FileExists(WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome\Application\chrome.exe") Then
    chromePath = """" & WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome\Application\chrome.exe"""
Else
    chromePath = "chrome"
End If

chromeArgs = " --app=http://localhost:3000/tv --start-fullscreen --autoplay-policy=no-user-gesture-required"

' Launch Google Chrome in fullscreen app mode on the TV (opened last to guarantee foreground focus)
WshShell.Run chromePath & chromeArgs, 1, False
