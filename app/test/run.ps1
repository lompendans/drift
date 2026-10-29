# Starts Drift from source with a throwaway data folder and the test hook on port 9417 (see testhook.js and t.sh).
$root = Split-Path $PSScriptRoot
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$root\*" } | Stop-Process -Force
Start-Sleep -Milliseconds 500
$env:DRIFT_DATA = "$env:TEMP\drift-test"
$env:DRIFT_TEST_PORT = "9417"
Start-Process -FilePath "$root\node_modules\electron\dist\electron.exe" -ArgumentList "`"$root`"" -RedirectStandardOutput "$env:TEMP\drift-test-out.txt" -RedirectStandardError "$env:TEMP\drift-test-err.txt"
