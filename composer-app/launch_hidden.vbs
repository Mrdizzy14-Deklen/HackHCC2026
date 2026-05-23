' Launch composer-app/main.py via pythonw with no console window.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot  = fso.GetParentFolderName(scriptDir)
pythonw   = repoRoot & "\venv\Scripts\pythonw.exe"
mainPy    = scriptDir & "\main.py"

If Not fso.FileExists(pythonw) Then
    pythonw = "pythonw.exe"
End If

sh.CurrentDirectory = repoRoot
sh.Run """" & pythonw & """ """ & mainPy & """", 0, False
