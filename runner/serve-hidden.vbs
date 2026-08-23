' Launch the schedule server (serve.js) with NO visible window.
' Self-locating: runs node in this file's own folder (runner).
' Used by the logon auto-start (Task Scheduler / Startup folder).
Option Explicit
Dim fso, sh, dir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
' 0 = hidden window, False = do not wait for it to finish
sh.Run "cmd /c node serve.js", 0, False
